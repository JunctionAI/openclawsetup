/**
 * Clawdbot Runtime Server
 * Individual instance that runs for each customer
 */

const express = require('express');
const { Client } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration from environment
const CONFIG = {
  customerId: process.env.CUSTOMER_ID,
  customerEmail: process.env.CUSTOMER_EMAIL,
  workspaceId: process.env.WORKSPACE_ID,
  planName: process.env.PLAN_NAME,
  messageLimit: parseInt(process.env.MESSAGE_LIMIT) || 5000,
  maxAgents: parseInt(process.env.MAX_AGENTS) || 3,
  features: (process.env.FEATURES || '').split(',').filter(Boolean),
  databaseUrl: process.env.DATABASE_URL,
  apiKey: process.env.API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY
};

// Database connection
let db;

// Anthropic client
const anthropic = new Anthropic({
  apiKey: CONFIG.anthropicApiKey
});

app.use(express.json());

// ========================================
// HEALTH & STATUS
// ========================================

app.get('/health', async (req, res) => {
  try {
    // Check database
    await db.query('SELECT 1');

    res.json({
      status: 'healthy',
      workspace: CONFIG.workspaceId,
      plan: CONFIG.planName,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'Clawdbot Instance',
    workspace: CONFIG.workspaceId,
    customer: CONFIG.customerEmail,
    plan: CONFIG.planName,
    version: '1.0.0',
    features: CONFIG.features
  });
});

app.get('/status', async (req, res) => {
  const usage = await getUsageStats();

  res.json({
    workspace: CONFIG.workspaceId,
    plan: {
      name: CONFIG.planName,
      limits: {
        messagesPerMonth: CONFIG.messageLimit,
        maxAgents: CONFIG.maxAgents
      }
    },
    usage: {
      messagesThisMonth: usage.messages,
      remainingMessages: Math.max(0, CONFIG.messageLimit - usage.messages),
      percentUsed: ((usage.messages / CONFIG.messageLimit) * 100).toFixed(1)
    },
    features: CONFIG.features
  });
});

// ========================================
// CHAT API
// ========================================

app.post('/api/chat', authenticateRequest, async (req, res) => {
  const { message, agentId = 'main', channel = 'api' } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message required' });
  }

  try {
    // Check usage limits
    const usage = await getUsageStats();
    if (usage.messages >= CONFIG.messageLimit) {
      return res.status(429).json({
        error: 'Message limit exceeded',
        limit: CONFIG.messageLimit,
        used: usage.messages
      });
    }

    // Store incoming message
    await storeMessage(agentId, channel, message, 'user');

    // Get conversation history
    const history = await getConversationHistory(agentId, channel);

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4',
      max_tokens: 4096,
      system: await getSystemPrompt(),
      messages: history
    });

    const reply = response.content[0].text;

    // Store response
    await storeMessage(agentId, channel, reply, 'assistant');

    // Track usage
    await trackUsage(1, response.usage.input_tokens + response.usage.output_tokens);

    res.json({
      reply,
      usage: {
        messagesUsed: usage.messages + 1,
        messagesRemaining: CONFIG.messageLimit - usage.messages - 1
      }
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// MEMORY API
// ========================================

app.post('/api/memory', authenticateRequest, async (req, res) => {
  const { content, metadata = {} } = req.body;

  try {
    await db.query(
      `INSERT INTO memories (agent_id, content, metadata, created_at)
       VALUES ($1, $2, $3, NOW())`,
      ['main', content, JSON.stringify(metadata)]
    );

    res.json({ success: true, message: 'Memory stored' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/memory/search', authenticateRequest, async (req, res) => {
  const { query, limit = 10 } = req.query;

  try {
    const result = await db.query(
      `SELECT content, metadata, created_at
       FROM memories
       WHERE content ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [`%${query}%`, limit]
    );

    res.json({ memories: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// SKILLS API
// ========================================

app.get('/api/skills', authenticateRequest, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT name, enabled, config FROM skills'
    );

    res.json({ skills: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/skills/:name/enable', authenticateRequest, async (req, res) => {
  const { name } = req.params;

  try {
    await db.query(
      `UPDATE skills SET enabled = true WHERE name = $1`,
      [name]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// WEBHOOKS
// ========================================

app.post('/webhook/:source', authenticateRequest, async (req, res) => {
  const { source } = req.params;
  const payload = req.body;

  console.log(`Webhook received from ${source}:`, payload);

  // Handle different webhook sources
  switch (source) {
    case 'gmail':
      await handleGmailWebhook(payload);
      break;
    case 'calendar':
      await handleCalendarWebhook(payload);
      break;
    default:
      console.log(`Unknown webhook source: ${source}`);
  }

  res.json({ received: true });
});

// ========================================
// HELPER FUNCTIONS
// ========================================

async function getSystemPrompt() {
  // In production, load from workspace files (SOUL.md, etc.)
  return `You are ${CONFIG.customerEmail}'s AI assistant.

Plan: ${CONFIG.planName}
Features: ${CONFIG.features.join(', ')}

You help with organization, productivity, and information management.
Be concise, helpful, and proactive.`;
}

async function getConversationHistory(agentId, channel, limit = 20) {
  const result = await db.query(
    `SELECT message, role
     FROM conversations
     WHERE agent_id = $1 AND channel = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [agentId, channel, limit]
  );

  // Format for Claude API
  return result.rows.reverse().map(row => ({
    role: row.role,
    content: row.message
  }));
}

async function storeMessage(agentId, channel, message, role) {
  await db.query(
    `INSERT INTO conversations (agent_id, channel, message, role, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [agentId, channel, message, role]
  );
}

async function trackUsage(messages, tokens) {
  const today = new Date().toISOString().split('T')[0];

  await db.query(
    `INSERT INTO usage_tracking (date, messages_sent, api_calls, tokens_used)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (date) DO UPDATE
     SET messages_sent = usage_tracking.messages_sent + $2,
         api_calls = usage_tracking.api_calls + 1,
         tokens_used = usage_tracking.tokens_used + $3`,
    [today, messages, tokens]
  );
}

async function getUsageStats() {
  const result = await db.query(
    `SELECT 
       COALESCE(SUM(messages_sent), 0) as messages,
       COALESCE(SUM(tokens_used), 0) as tokens
     FROM usage_tracking
     WHERE date >= date_trunc('month', CURRENT_DATE)`
  );

  return result.rows[0];
}

async function handleGmailWebhook(payload) {
  // TODO: Process Gmail webhook
  console.log('Gmail webhook:', payload);
}

async function handleCalendarWebhook(payload) {
  // TODO: Process Calendar webhook
  console.log('Calendar webhook:', payload);
}

// ========================================
// AUTHENTICATION
// ========================================

function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.substring(7);

  if (token !== CONFIG.apiKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

// ========================================
// DATABASE INITIALIZATION
// ========================================

async function initDatabase() {
  db = new Client({
    connectionString: CONFIG.databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  await db.connect();
  console.log('✅ Database connected');

  // Ensure tables exist (should already be created by provisioning)
  await db.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      agent_id VARCHAR(255) NOT NULL,
      channel VARCHAR(100),
      message TEXT NOT NULL,
      role VARCHAR(50),
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usage_tracking (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL UNIQUE,
      messages_sent INT DEFAULT 0,
      api_calls INT DEFAULT 0,
      tokens_used BIGINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log('✅ Database schema verified');
}

// ========================================
// START SERVER
// ========================================

app.listen(PORT, async () => {
  console.log(`🤖 Clawdbot instance starting...`);
  console.log(`   Workspace: ${CONFIG.workspaceId}`);
  console.log(`   Customer: ${CONFIG.customerEmail}`);
  console.log(`   Plan: ${CONFIG.planName}`);
  console.log(`   Features: ${CONFIG.features.join(', ')}`);
  console.log(``);

  await initDatabase();

  console.log(`\n✅ Clawdbot instance running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Status: http://localhost:${PORT}/status`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await db.end();
  process.exit(0);
});
