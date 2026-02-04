/**
 * Telegram Bot Integration API
 * Handles bot token registration, webhook setup, and message forwarding
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { encrypt, decrypt } = require('../lib/encryption');
const { logSecurityEvent } = require('../lib/security');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : false
});

// Telegram API base URL
const TELEGRAM_API = 'https://api.telegram.org/bot';

// Backend URL for webhook (set in Railway)
const BACKEND_URL = process.env.BACKEND_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:3000';

/**
 * Helper: Call Telegram Bot API
 */
async function callTelegramAPI(token, method, body = null) {
  const url = `${TELEGRAM_API}${token}/${method}`;
  
  const options = {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  if (!data.ok) {
    throw new Error(data.description || 'Telegram API error');
  }
  
  return data.result;
}

/**
 * Helper: Authenticate workspace request
 */
async function authenticateWorkspace(req, res, next) {
  const workspaceId = req.params.workspaceId;
  const authHeader = req.headers.authorization;
  
  if (!workspaceId) {
    return res.status(400).json({ error: 'Workspace ID required' });
  }
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  
  const apiKey = authHeader.substring(7);
  
  try {
    const result = await pool.query(
      'SELECT workspace_id, email, plan, status FROM customers WHERE workspace_id = $1 AND api_key = $2',
      [workspaceId, apiKey]
    );
    
    if (result.rows.length === 0) {
      logSecurityEvent('TELEGRAM_AUTH_FAILED', { workspaceId, ip: req.ip });
      return res.status(403).json({ error: 'Invalid API key or workspace' });
    }
    
    if (result.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'Subscription not active' });
    }
    
    req.workspace = result.rows[0];
    req.workspaceId = workspaceId;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * POST /api/telegram/:workspaceId/connect
 * Validate and store Telegram bot token, set up webhook
 */
router.post('/:workspaceId/connect', authenticateWorkspace, async (req, res) => {
  const { token } = req.body;
  const { workspaceId } = req;
  
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Bot token is required' });
  }
  
  // Basic token format validation (number:alphanumeric)
  if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
    return res.status(400).json({ error: 'Invalid bot token format' });
  }
  
  try {
    // Step 1: Validate token with Telegram getMe API
    console.log(`🔄 Validating Telegram token for workspace ${workspaceId}...`);
    
    let botInfo;
    try {
      botInfo = await callTelegramAPI(token, 'getMe');
    } catch (error) {
      console.error('Token validation failed:', error.message);
      return res.status(400).json({ 
        error: 'Invalid bot token',
        details: 'Could not connect to Telegram with this token. Please check it is correct.'
      });
    }
    
    console.log(`✅ Token valid! Bot: @${botInfo.username} (${botInfo.first_name})`);
    
    // Step 2: Encrypt and store token
    const encryptedToken = encrypt(token);
    
    await pool.query(`
      INSERT INTO telegram_bots (workspace_id, bot_id, bot_username, bot_name, token_encrypted, status, created_at)
      VALUES ($1, $2, $3, $4, $5, 'active', NOW())
      ON CONFLICT (workspace_id) DO UPDATE SET
        bot_id = $2,
        bot_username = $3,
        bot_name = $4,
        token_encrypted = $5,
        status = 'active',
        updated_at = NOW()
    `, [workspaceId, botInfo.id, botInfo.username, botInfo.first_name, encryptedToken]);
    
    console.log(`✅ Token stored for workspace ${workspaceId}`);
    
    // Step 3: Set webhook URL
    const webhookUrl = `${BACKEND_URL}/api/telegram/webhook/${workspaceId}`;
    
    console.log(`🔄 Setting webhook to: ${webhookUrl}`);
    
    try {
      await callTelegramAPI(token, 'setWebhook', {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true
      });
      
      // Verify webhook was set
      const webhookInfo = await callTelegramAPI(token, 'getWebhookInfo');
      
      if (webhookInfo.url !== webhookUrl) {
        throw new Error('Webhook URL mismatch after setting');
      }
      
      console.log(`✅ Webhook set successfully!`);
      
      // Update webhook URL in database
      await pool.query(
        'UPDATE telegram_bots SET webhook_url = $1 WHERE workspace_id = $2',
        [webhookUrl, workspaceId]
      );
      
    } catch (error) {
      console.error('Webhook setup failed:', error.message);
      // Still return success - token is valid, webhook can be retried
      return res.status(200).json({
        success: true,
        bot: {
          id: botInfo.id,
          username: botInfo.username,
          name: botInfo.first_name
        },
        webhookUrl,
        webhookStatus: 'failed',
        webhookError: error.message,
        message: 'Bot connected but webhook setup failed. Messages may not be received.'
      });
    }
    
    logSecurityEvent('TELEGRAM_BOT_CONNECTED', {
      workspaceId,
      botUsername: botInfo.username,
      botId: botInfo.id
    });
    
    res.json({
      success: true,
      bot: {
        id: botInfo.id,
        username: botInfo.username,
        name: botInfo.first_name
      },
      webhookUrl,
      webhookStatus: 'active',
      message: `Bot @${botInfo.username} connected successfully! Send a message to test.`
    });
    
  } catch (error) {
    console.error('Telegram connect error:', error);
    res.status(500).json({ error: 'Failed to connect Telegram bot', details: error.message });
  }
});

/**
 * GET /api/telegram/:workspaceId/status
 * Get Telegram bot connection status
 */
router.get('/:workspaceId/status', authenticateWorkspace, async (req, res) => {
  const { workspaceId } = req;
  
  try {
    const result = await pool.query(
      'SELECT bot_id, bot_username, bot_name, webhook_url, status, created_at, updated_at FROM telegram_bots WHERE workspace_id = $1',
      [workspaceId]
    );
    
    if (result.rows.length === 0) {
      return res.json({
        connected: false,
        message: 'No Telegram bot connected to this workspace'
      });
    }
    
    const bot = result.rows[0];
    
    res.json({
      connected: true,
      bot: {
        id: bot.bot_id,
        username: bot.bot_username,
        name: bot.bot_name
      },
      webhookUrl: bot.webhook_url,
      status: bot.status,
      connectedAt: bot.created_at,
      updatedAt: bot.updated_at
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * DELETE /api/telegram/:workspaceId/disconnect
 * Disconnect Telegram bot
 */
router.delete('/:workspaceId/disconnect', authenticateWorkspace, async (req, res) => {
  const { workspaceId } = req;
  
  try {
    // Get token to remove webhook
    const result = await pool.query(
      'SELECT token_encrypted FROM telegram_bots WHERE workspace_id = $1',
      [workspaceId]
    );
    
    if (result.rows.length > 0 && result.rows[0].token_encrypted) {
      try {
        const token = decrypt(result.rows[0].token_encrypted);
        await callTelegramAPI(token, 'deleteWebhook');
        console.log(`✅ Webhook removed for workspace ${workspaceId}`);
      } catch (error) {
        console.warn('Failed to remove webhook:', error.message);
      }
    }
    
    // Remove from database
    await pool.query('DELETE FROM telegram_bots WHERE workspace_id = $1', [workspaceId]);
    
    logSecurityEvent('TELEGRAM_BOT_DISCONNECTED', { workspaceId });
    
    res.json({ success: true, message: 'Telegram bot disconnected' });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

/**
 * POST /api/telegram/webhook/:workspaceId
 * Receive incoming messages from Telegram
 */
router.post('/webhook/:workspaceId', async (req, res) => {
  const { workspaceId } = req.params;
  const update = req.body;
  
  // Acknowledge immediately (Telegram expects quick response)
  res.sendStatus(200);
  
  // Process message asynchronously
  processUpdate(workspaceId, update).catch(error => {
    console.error(`Error processing Telegram update for ${workspaceId}:`, error);
  });
});

/**
 * Process incoming Telegram update
 */
async function processUpdate(workspaceId, update) {
  // Handle message updates
  const message = update.message || update.edited_message;
  
  if (!message || !message.text) {
    console.log('Ignoring non-text update');
    return;
  }
  
  const chatId = message.chat.id;
  const userId = message.from.id;
  const userFirstName = message.from.first_name || 'User';
  const text = message.text;
  
  console.log(`📩 Telegram message for ${workspaceId}: ${text.substring(0, 50)}...`);
  
  try {
    // Get bot token and workspace info
    const botResult = await pool.query(
      'SELECT token_encrypted FROM telegram_bots WHERE workspace_id = $1 AND status = $2',
      [workspaceId, 'active']
    );
    
    if (botResult.rows.length === 0) {
      console.error(`No active bot for workspace ${workspaceId}`);
      return;
    }
    
    const token = decrypt(botResult.rows[0].token_encrypted);
    
    // Get workspace plan info
    const customerResult = await pool.query(
      'SELECT plan FROM customers WHERE workspace_id = $1',
      [workspaceId]
    );
    
    const plan = customerResult.rows[0]?.plan || 'Starter';
    
    // Store incoming message in conversations
    await pool.query(`
      INSERT INTO conversations (workspace_id, agent_id, channel, message, role, metadata, created_at)
      VALUES ($1, 'main', 'telegram', $2, 'user', $3, NOW())
    `, [workspaceId, text, JSON.stringify({ chatId, userId, userName: userFirstName })]);
    
    // Send "typing" indicator
    await callTelegramAPI(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
    
    // Generate AI response
    let response;
    
    if (process.env.ANTHROPIC_API_KEY) {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      
      // Get recent conversation history for context
      const historyResult = await pool.query(`
        SELECT message, role FROM conversations
        WHERE workspace_id = $1 AND channel = 'telegram'
          AND (metadata->>'chatId')::text = $2
        ORDER BY created_at DESC LIMIT 10
      `, [workspaceId, String(chatId)]);
      
      const conversationHistory = historyResult.rows.reverse().map(row => ({
        role: row.role,
        content: row.message
      }));
      
      const completion = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: `You are a helpful AI assistant connected via Telegram. Be concise and friendly. User's name is ${userFirstName}. Current plan: ${plan}.`,
        messages: conversationHistory
      });
      
      response = completion.content[0].text;
    } else {
      // Fallback response if no AI API key
      response = `Hello ${userFirstName}! Your message was received, but AI responses are not configured yet. Please contact support.`;
    }
    
    // Store response in conversations
    await pool.query(`
      INSERT INTO conversations (workspace_id, agent_id, channel, message, role, metadata, created_at)
      VALUES ($1, 'main', 'telegram', $2, 'assistant', $3, NOW())
    `, [workspaceId, response, JSON.stringify({ chatId, userId })]);
    
    // Track usage
    const today = new Date().toISOString().split('T')[0];
    await pool.query(`
      INSERT INTO usage_tracking (workspace_id, date, messages_sent, api_calls, tokens_used)
      VALUES ($1, $2, 1, 1, 500)
      ON CONFLICT (workspace_id, date)
      DO UPDATE SET
        messages_sent = usage_tracking.messages_sent + 1,
        api_calls = usage_tracking.api_calls + 1,
        tokens_used = usage_tracking.tokens_used + 500
    `, [workspaceId, today]);
    
    // Send response to Telegram
    await callTelegramAPI(token, 'sendMessage', {
      chat_id: chatId,
      text: response,
      parse_mode: 'Markdown'
    });
    
    console.log(`✅ Sent response to Telegram chat ${chatId}`);
    
  } catch (error) {
    console.error('Error processing Telegram message:', error);
    
    // Try to send error message to user
    try {
      const botResult = await pool.query(
        'SELECT token_encrypted FROM telegram_bots WHERE workspace_id = $1',
        [workspaceId]
      );
      
      if (botResult.rows.length > 0) {
        const token = decrypt(botResult.rows[0].token_encrypted);
        await callTelegramAPI(token, 'sendMessage', {
          chat_id: message.chat.id,
          text: '⚠️ Sorry, I encountered an error processing your message. Please try again.'
        });
      }
    } catch (e) {
      console.error('Failed to send error message:', e);
    }
  }
}

module.exports = router;
