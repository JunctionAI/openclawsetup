/**
 * Workspace API Router
 * Handles workspace management and chat API
 * 
 * SEC-011 fix: Create workspace router that was previously missing
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { escapeLikePattern, logSecurityEvent, validateWorkspaceId } = require('../lib/security');

// Database connection
// SEC-006 FIX: Use proper SSL config - in production, Neon provides valid certs
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: true }  // Validate SSL certs in production
    : false
});

/**
 * Middleware: Authenticate workspace requests
 */
async function authenticateWorkspace(req, res, next) {
  const workspaceId = req.params.workspaceId || req.params.id;
  const authHeader = req.headers.authorization;
  
  if (!workspaceId) {
    return res.status(400).json({ error: 'Workspace ID required' });
  }
  
  // For public endpoints (info), allow without auth
  if (req.path.includes('/info')) {
    req.workspaceId = workspaceId;
    return next();
  }
  
  // Require authentication for other endpoints
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  
  const apiKey = authHeader.substring(7);
  
  try {
    // Verify API key matches workspace
    const result = await pool.query(
      'SELECT workspace_id, email, plan, status FROM customers WHERE workspace_id = $1 AND api_key = $2',
      [workspaceId, apiKey]
    );
    
    if (result.rows.length === 0) {
      // SEC-008: Log failed auth attempts
      logSecurityEvent('AUTH_FAILED', {
        workspaceId,
        reason: 'Invalid API key or workspace',
        ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      });
      return res.status(403).json({ error: 'Invalid API key or workspace' });
    }
    
    const customer = result.rows[0];
    
    // Check if subscription is active
    if (customer.status !== 'active') {
      return res.status(403).json({ 
        error: 'Subscription not active',
        status: customer.status
      });
    }
    
    req.workspace = customer;
    req.workspaceId = workspaceId;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * GET /api/workspace/:id
 * Get workspace info (public, minimal data)
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT workspace_id, plan, status, created_at FROM customers WHERE workspace_id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    
    const workspace = result.rows[0];
    
    res.json({
      workspaceId: workspace.workspace_id,
      plan: workspace.plan,
      status: workspace.status,
      createdAt: workspace.created_at
    });
  } catch (error) {
    console.error('Workspace fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch workspace' });
  }
});

/**
 * GET /api/workspace/:id/status
 * Get detailed workspace status (authenticated)
 */
router.get('/:id/status', authenticateWorkspace, async (req, res) => {
  try {
    // Get usage stats
    const usageResult = await pool.query(`
      SELECT 
        COALESCE(SUM(messages_sent), 0) as messages_this_month,
        COALESCE(SUM(tokens_used), 0) as tokens_this_month
      FROM usage_tracking
      WHERE workspace_id = $1
        AND date >= date_trunc('month', CURRENT_DATE)
    `, [req.workspaceId]);
    
    const usage = usageResult.rows[0];
    
    // Get plan limits
    const PLAN_LIMITS = {
      'Starter': { messages: 5000, agents: 3 },
      'Pro': { messages: 20000, agents: 10 },
      'Team': { messages: 100000, agents: -1 }
    };
    
    const limits = PLAN_LIMITS[req.workspace.plan] || PLAN_LIMITS['Starter'];
    
    res.json({
      workspaceId: req.workspaceId,
      plan: req.workspace.plan,
      status: req.workspace.status,
      usage: {
        messagesThisMonth: parseInt(usage.messages_this_month),
        messagesLimit: limits.messages,
        messagesRemaining: Math.max(0, limits.messages - parseInt(usage.messages_this_month)),
        percentUsed: ((parseInt(usage.messages_this_month) / limits.messages) * 100).toFixed(1)
      },
      limits
    });
  } catch (error) {
    console.error('Status fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

/**
 * POST /api/workspace/:id/chat
 * Send chat message to workspace
 */
router.post('/:id/chat', authenticateWorkspace, async (req, res) => {
  const { message, agentId = 'main', channel = 'api' } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  if (message.length > 32000) {
    return res.status(400).json({ error: 'Message too long (max 32000 characters)' });
  }
  
  try {
    // Check rate limits
    const usageResult = await pool.query(`
      SELECT COALESCE(SUM(messages_sent), 0) as count
      FROM usage_tracking
      WHERE workspace_id = $1
        AND date >= date_trunc('month', CURRENT_DATE)
    `, [req.workspaceId]);
    
    const PLAN_LIMITS = {
      'Starter': 5000,
      'Pro': 20000,
      'Team': 100000
    };
    
    const limit = PLAN_LIMITS[req.workspace.plan] || 5000;
    const used = parseInt(usageResult.rows[0].count);
    
    if (used >= limit) {
      return res.status(429).json({
        error: 'Message limit exceeded',
        limit,
        used
      });
    }
    
    // Store incoming message
    await pool.query(`
      INSERT INTO conversations (workspace_id, agent_id, channel, message, role, created_at)
      VALUES ($1, $2, $3, $4, 'user', NOW())
    `, [req.workspaceId, agentId, channel, message]);
    
    // TODO: Call actual Clawdbot runtime
    // For now, return a placeholder response
    const response = `Thanks for your message! Your workspace (${req.workspaceId}) is being set up. Full AI responses coming soon.`;
    
    // Store response
    await pool.query(`
      INSERT INTO conversations (workspace_id, agent_id, channel, message, role, created_at)
      VALUES ($1, $2, $3, $4, 'assistant', NOW())
    `, [req.workspaceId, agentId, channel, response]);
    
    // Track usage
    const today = new Date().toISOString().split('T')[0];
    await pool.query(`
      INSERT INTO usage_tracking (workspace_id, date, messages_sent, api_calls, tokens_used)
      VALUES ($1, $2, 1, 1, 100)
      ON CONFLICT (workspace_id, date) 
      DO UPDATE SET 
        messages_sent = usage_tracking.messages_sent + 1,
        api_calls = usage_tracking.api_calls + 1,
        tokens_used = usage_tracking.tokens_used + 100
    `, [req.workspaceId, today]);
    
    res.json({
      response,
      usage: {
        messagesUsed: used + 1,
        messagesRemaining: limit - used - 1
      }
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Chat failed' });
  }
});

/**
 * GET /api/workspace/:id/conversations
 * Get conversation history
 */
router.get('/:id/conversations', authenticateWorkspace, async (req, res) => {
  const { limit = 50, offset = 0, agentId = 'main' } = req.query;
  
  try {
    const result = await pool.query(`
      SELECT message, role, channel, created_at
      FROM conversations
      WHERE workspace_id = $1 AND agent_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `, [req.workspaceId, agentId, Math.min(parseInt(limit), 100), parseInt(offset)]);
    
    res.json({
      conversations: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: result.rows.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Conversations fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * POST /api/workspace/:id/memory
 * Store a memory
 */
router.post('/:id/memory', authenticateWorkspace, async (req, res) => {
  const { content, metadata = {} } = req.body;
  
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Content is required' });
  }
  
  try {
    const result = await pool.query(`
      INSERT INTO memories (workspace_id, agent_id, content, metadata, created_at)
      VALUES ($1, 'main', $2, $3, NOW())
      RETURNING id
    `, [req.workspaceId, content, JSON.stringify(metadata)]);
    
    res.json({
      success: true,
      memoryId: result.rows[0].id
    });
  } catch (error) {
    console.error('Memory store error:', error);
    res.status(500).json({ error: 'Failed to store memory' });
  }
});

/**
 * GET /api/workspace/:id/memory/search
 * Search memories
 * SEC-009 FIX: Escape LIKE special characters to prevent injection
 */
router.get('/:id/memory/search', authenticateWorkspace, async (req, res) => {
  const { query, limit = 10 } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }
  
  // Validate query length
  if (query.length > 500) {
    return res.status(400).json({ error: 'Query too long (max 500 characters)' });
  }
  
  try {
    // SEC-009 FIX: Escape special LIKE characters to prevent pattern injection
    const escapedQuery = escapeLikePattern(query);
    
    const result = await pool.query(`
      SELECT id, content, metadata, created_at
      FROM memories
      WHERE workspace_id = $1
        AND content ILIKE $2 ESCAPE '\\'
      ORDER BY created_at DESC
      LIMIT $3
    `, [req.workspaceId, `%${escapedQuery}%`, Math.min(parseInt(limit), 100)]);
    
    res.json({
      memories: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Memory search error:', error);
    res.status(500).json({ error: 'Failed to search memories' });
  }
});

module.exports = router;
