/**
 * Workspace API endpoints
 * Handles chat, status, and workspace management
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * Get workspace info
 */
router.get('/:workspaceId', async (req, res) => {
  const { workspaceId } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM customers WHERE workspace_id = $1',
      [workspaceId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    
    const workspace = result.rows[0];
    
    res.json({
      workspaceId,
      email: workspace.email,
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
 * Chat with workspace Clawdbot
 */
const chatHandler = require('./chat-handler');

router.post('/:workspaceId/chat', async (req, res) => {
  const { workspaceId } = req.params;
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }
  
  try {
    // Get customer plan from database
    const customerResult = await pool.query(
      'SELECT plan FROM customers WHERE workspace_id = $1',
      [workspaceId]
    );
    
    const plan = customerResult.rows[0]?.plan || 'Starter';
    
    // Use the improved chat handler (works without CLI)
    const result = await chatHandler.chat(workspaceId, message, { plan });
    
    // Log conversation to database
    await pool.query(
      'INSERT INTO conversations (workspace_id, user_message, assistant_response, created_at) VALUES ($1, $2, $3, NOW())',
      [workspaceId, message, result.response]
    );
    
    res.json({
      response: result.response,
      memory_updated: result.memory_updated || false,
      model: result.model
    });
    
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Chat failed',
      response: "I encountered an error. Please try again or contact support if this persists."
    });
  }
});

/**
 * Get workspace memory/logs
 */
router.get('/:workspaceId/memory', async (req, res) => {
  const { workspaceId } = req.params;
  const fs = require('fs');
  const path = require('path');
  
  try {
    const memoryPath = path.join('./workspaces', workspaceId, 'memory');
    
    if (!fs.existsSync(memoryPath)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(memoryPath)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        name: f,
        path: path.join(memoryPath, f),
        size: fs.statSync(path.join(memoryPath, f)).size,
        modified: fs.statSync(path.join(memoryPath, f)).mtime
      }));
    
    res.json({ files });
  } catch (error) {
    console.error('Memory fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch memory' });
  }
});

module.exports = router;
