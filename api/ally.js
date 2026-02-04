/**
 * Ally Bot - Multi-tenant Telegram Bot Handler
 * 
 * One bot (@AllyBot), multiple users. Routes messages based on Telegram user ID.
 * 
 * Flow:
 * 1. User signs up on web → gets unique link code
 * 2. User sends /start <code> to @AllyBot
 * 3. We link their Telegram ID to their workspace
 * 4. Future messages route to their workspace
 * 
 * Commands:
 * /start [CODE] - Start bot / link account with code
 * /help - Show available commands
 * /status - Show account status
 * /unlink - Disconnect Telegram from account
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const crypto = require('crypto');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : false
});

// Ally Bot token from environment (supports both names)
const ALLY_BOT_TOKEN = process.env.ALLY_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = 'https://api.telegram.org/bot';
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://setupclaw.com';

/**
 * Helper: Call Telegram Bot API
 */
async function sendTelegramMessage(chatId, text, options = {}) {
  if (!ALLY_BOT_TOKEN) {
    console.error('❌ ALLY_BOT_TOKEN not configured');
    return null;
  }
  
  const url = `${TELEGRAM_API}${ALLY_BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...options
      })
    });
    
    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram API error:', data.description);
    }
    return data;
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return null;
  }
}

/**
 * Generate a unique link code for workspace
 */
function generateLinkCode() {
  // 6 character alphanumeric code (easy to type)
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

/**
 * POST /api/ally/create-workspace
 * Create workspace for authenticated user
 */
router.post('/create-workspace', async (req, res) => {
  const { email, name, googleId } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  try {
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id, workspace_id FROM ally_users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      
      // Get workspace details
      const workspace = await pool.query(
        'SELECT * FROM ally_workspaces WHERE id = $1',
        [user.workspace_id]
      );
      
      const ws = workspace.rows[0];
      
      // Get link status
      const link = await pool.query(
        'SELECT telegram_user_id FROM ally_telegram_links WHERE workspace_id = $1',
        [user.workspace_id]
      );
      
      return res.json({
        success: true,
        existing: true,
        userId: user.id,
        workspaceId: user.workspace_id,
        linkCode: ws.link_code,
        telegramLinked: link.rows.length > 0,
        telegramUserId: link.rows[0]?.telegram_user_id || null
      });
    }
    
    // Create new workspace
    const workspaceId = `ws_${crypto.randomBytes(8).toString('hex')}`;
    const linkCode = generateLinkCode();
    const apiKey = `ally_${crypto.randomBytes(16).toString('hex')}`;
    
    // Insert workspace
    await pool.query(`
      INSERT INTO ally_workspaces (id, link_code, api_key, plan, status, created_at)
      VALUES ($1, $2, $3, 'free', 'active', NOW())
    `, [workspaceId, linkCode, apiKey]);
    
    // Insert user
    const userResult = await pool.query(`
      INSERT INTO ally_users (email, name, google_id, workspace_id, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `, [email, name || null, googleId || null, workspaceId]);
    
    const userId = userResult.rows[0].id;
    
    console.log(`✅ Created workspace ${workspaceId} for ${email}`);
    
    res.json({
      success: true,
      existing: false,
      userId,
      workspaceId,
      linkCode,
      telegramLinked: false
    });
    
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(500).json({ error: 'Failed to create workspace', details: error.message });
  }
});

/**
 * GET /api/ally/link-status
 * Check if user's Telegram is linked
 */
router.get('/link-status', async (req, res) => {
  const { email, workspaceId } = req.query;
  
  if (!email && !workspaceId) {
    return res.status(400).json({ error: 'Email or workspaceId required' });
  }
  
  try {
    let wsId = workspaceId;
    
    // Get workspace ID from email if not provided
    if (!wsId && email) {
      const user = await pool.query(
        'SELECT workspace_id FROM ally_users WHERE email = $1',
        [email]
      );
      if (user.rows.length === 0) {
        return res.json({ linked: false, error: 'User not found' });
      }
      wsId = user.rows[0].workspace_id;
    }
    
    // Check link status
    const link = await pool.query(
      'SELECT telegram_user_id, telegram_username, telegram_first_name, linked_at FROM ally_telegram_links WHERE workspace_id = $1',
      [wsId]
    );
    
    if (link.rows.length === 0) {
      return res.json({ linked: false, workspaceId: wsId });
    }
    
    const l = link.rows[0];
    res.json({
      linked: true,
      workspaceId: wsId,
      telegram: {
        userId: l.telegram_user_id,
        username: l.telegram_username,
        firstName: l.telegram_first_name,
        linkedAt: l.linked_at
      }
    });
    
  } catch (error) {
    console.error('Link status error:', error);
    res.status(500).json({ error: 'Failed to check link status' });
  }
});

/**
 * POST /api/ally/webhook
 * Incoming messages from Telegram to @AllyBot
 */
router.post('/webhook', async (req, res) => {
  const update = req.body;
  
  // Acknowledge immediately (Telegram expects quick response)
  res.sendStatus(200);
  
  // Process asynchronously
  processAllyUpdate(update).catch(error => {
    console.error('Error processing Ally update:', error);
  });
});

/**
 * Process incoming Telegram update
 */
async function processAllyUpdate(update) {
  const message = update.message || update.edited_message;
  
  if (!message || !message.text) {
    return; // Ignore non-text messages
  }
  
  const chatId = message.chat.id;
  const userId = message.from.id;
  const username = message.from.username;
  const firstName = message.from.first_name || 'User';
  const text = message.text.trim();
  
  console.log(`📩 Ally message from ${firstName} (@${username || userId}): ${text.substring(0, 50)}`);
  
  // Handle /start command with link code
  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const code = parts[1]?.toUpperCase();
    
    if (code) {
      await handleLinkCode(chatId, userId, username, firstName, code);
    } else {
      await handleStart(chatId, userId, username, firstName);
    }
    return;
  }
  
  // Handle /help command
  if (text === '/help') {
    await sendTelegramMessage(chatId,
      `📚 *Ally Commands*\n\n` +
      `/start - Connect your account\n` +
      `/start CODE - Link with your code\n` +
      `/status - Check your account status\n` +
      `/unlink - Disconnect your Telegram\n` +
      `/help - Show this help\n\n` +
      `💡 Or just send me any message and I'll chat with you!`
    );
    return;
  }
  
  // Handle /status command
  if (text === '/status') {
    await handleStatus(chatId, userId, firstName);
    return;
  }
  
  // Handle /unlink command
  if (text === '/unlink') {
    await handleUnlink(chatId, userId, firstName);
    return;
  }
  
  // Check if user is linked to a workspace
  const link = await pool.query(
    'SELECT workspace_id FROM ally_telegram_links WHERE telegram_user_id = $1',
    [String(userId)]
  );
  
  if (link.rows.length === 0) {
    // Not linked - prompt to link
    await sendTelegramMessage(chatId,
      `👋 Hi ${firstName}!\n\n` +
      `To use Ally, you need to connect your account first.\n\n` +
      `1. Go to ${WEBSITE_URL}/setup\n` +
      `2. Sign in with Google\n` +
      `3. You'll get a code to send here\n\n` +
      `Already have a code? Send:\n` +
      `/start YOUR_CODE`
    );
    return;
  }
  
  const workspaceId = link.rows[0].workspace_id;
  
  // Route message to workspace
  await handleUserMessage(chatId, userId, firstName, workspaceId, text);
}

/**
 * Handle /start with link code
 */
async function handleLinkCode(chatId, userId, username, firstName, code) {
  try {
    // Find workspace with this link code
    const workspace = await pool.query(
      'SELECT id FROM ally_workspaces WHERE link_code = $1 AND status = $2',
      [code, 'active']
    );
    
    if (workspace.rows.length === 0) {
      await sendTelegramMessage(chatId,
        `❌ Invalid or expired code: \`${code}\`\n\n` +
        `Please check your code and try again, or get a new one at:\n` +
        `${WEBSITE_URL}/setup`
      );
      return;
    }
    
    const workspaceId = workspace.rows[0].id;
    
    // Check if this Telegram user is already linked to another workspace
    const existingLink = await pool.query(
      'SELECT workspace_id FROM ally_telegram_links WHERE telegram_user_id = $1',
      [String(userId)]
    );
    
    if (existingLink.rows.length > 0) {
      if (existingLink.rows[0].workspace_id === workspaceId) {
        await sendTelegramMessage(chatId,
          `✅ You're already connected!\n\n` +
          `Just send me a message and I'll respond.`
        );
      } else {
        // Update to new workspace
        await pool.query(`
          UPDATE ally_telegram_links 
          SET workspace_id = $1, linked_at = NOW()
          WHERE telegram_user_id = $2
        `, [workspaceId, String(userId)]);
        
        await sendTelegramMessage(chatId,
          `✅ Switched to your new account!\n\n` +
          `You're now connected. Send me a message to get started!`
        );
      }
      return;
    }
    
    // Create new link
    await pool.query(`
      INSERT INTO ally_telegram_links (workspace_id, telegram_user_id, telegram_username, telegram_first_name, telegram_chat_id, linked_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [workspaceId, String(userId), username || null, firstName, String(chatId)]);
    
    console.log(`✅ Linked Telegram user ${userId} to workspace ${workspaceId}`);
    
    await sendTelegramMessage(chatId,
      `🎉 *Welcome to Ally, ${firstName}!*\n\n` +
      `Your account is now connected. I'm your personal AI assistant.\n\n` +
      `You can:\n` +
      `• Ask me anything\n` +
      `• Set reminders\n` +
      `• Get help with tasks\n` +
      `• Have natural conversations\n\n` +
      `Try saying "Hello" to get started!`
    );
    
  } catch (error) {
    console.error('Link code error:', error);
    await sendTelegramMessage(chatId,
      `⚠️ Something went wrong linking your account. Please try again.`
    );
  }
}

/**
 * Handle /start without code
 */
async function handleStart(chatId, userId, username, firstName) {
  // Check if already linked
  const link = await pool.query(
    'SELECT workspace_id FROM ally_telegram_links WHERE telegram_user_id = $1',
    [String(userId)]
  );
  
  if (link.rows.length > 0) {
    await sendTelegramMessage(chatId,
      `👋 Welcome back, ${firstName}!\n\n` +
      `You're already connected. Just send me a message and I'll respond.`
    );
    return;
  }
  
  await sendTelegramMessage(chatId,
    `👋 Hi ${firstName}! I'm Ally, your personal AI assistant.\n\n` +
    `To get started, you need to create an account:\n\n` +
    `1. Go to ${WEBSITE_URL}/setup\n` +
    `2. Sign in with Google (takes 10 seconds)\n` +
    `3. Click the link to connect your Telegram\n\n` +
    `See you soon! 🚀`
  );
}

/**
 * Handle /status command
 */
async function handleStatus(chatId, userId, firstName) {
  try {
    const link = await pool.query(`
      SELECT atl.workspace_id, atl.linked_at, au.email, aw.plan, aw.status
      FROM ally_telegram_links atl
      JOIN ally_workspaces aw ON aw.id = atl.workspace_id
      LEFT JOIN ally_users au ON au.workspace_id = atl.workspace_id
      WHERE atl.telegram_user_id = $1
    `, [String(userId)]);
    
    if (link.rows.length === 0) {
      await sendTelegramMessage(chatId,
        `📊 *Account Status*\n\n` +
        `❌ Not connected\n\n` +
        `Use /start CODE to link your account.`
      );
      return;
    }
    
    const info = link.rows[0];
    const linkedDate = new Date(info.linked_at).toLocaleDateString();
    
    await sendTelegramMessage(chatId,
      `📊 *Account Status*\n\n` +
      `✅ Connected\n` +
      `📧 ${info.email || 'Email not set'}\n` +
      `📦 Plan: ${info.plan || 'Free'}\n` +
      `🔗 Linked: ${linkedDate}\n` +
      `⚡ Status: ${info.status === 'active' ? 'Active' : 'Inactive'}`
    );
  } catch (error) {
    console.error('Status error:', error);
    await sendTelegramMessage(chatId, `⚠️ Could not fetch status. Try again later.`);
  }
}

/**
 * Handle /unlink command
 */
async function handleUnlink(chatId, userId, firstName) {
  try {
    const link = await pool.query(
      'SELECT workspace_id FROM ally_telegram_links WHERE telegram_user_id = $1',
      [String(userId)]
    );
    
    if (link.rows.length === 0) {
      await sendTelegramMessage(chatId, `You're not linked to any account.`);
      return;
    }
    
    await pool.query(
      'DELETE FROM ally_telegram_links WHERE telegram_user_id = $1',
      [String(userId)]
    );
    
    console.log(`✅ Unlinked Telegram user ${userId} from workspace ${link.rows[0].workspace_id}`);
    
    await sendTelegramMessage(chatId,
      `✅ Your Telegram has been disconnected.\n\n` +
      `You can link a different account anytime with /start CODE`
    );
  } catch (error) {
    console.error('Unlink error:', error);
    await sendTelegramMessage(chatId, `⚠️ Could not unlink. Try again later.`);
  }
}

/**
 * Handle regular user message
 */
async function handleUserMessage(chatId, userId, firstName, workspaceId, text) {
  try {
    // Get workspace info
    const workspace = await pool.query(
      'SELECT plan, status FROM ally_workspaces WHERE id = $1',
      [workspaceId]
    );
    
    if (workspace.rows.length === 0 || workspace.rows[0].status !== 'active') {
      await sendTelegramMessage(chatId,
        `⚠️ Your account is inactive. Please visit ${WEBSITE_URL} to reactivate.`
      );
      return;
    }
    
    // Store incoming message
    await pool.query(`
      INSERT INTO ally_conversations (workspace_id, telegram_user_id, message, role, created_at)
      VALUES ($1, $2, $3, 'user', NOW())
    `, [workspaceId, String(userId), text]);
    
    // Send typing indicator
    await fetch(`${TELEGRAM_API}${ALLY_BOT_TOKEN}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' })
    });
    
    // Generate AI response
    let response;
    
    if (process.env.ANTHROPIC_API_KEY) {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      
      // Get recent conversation history
      const historyResult = await pool.query(`
        SELECT message, role FROM ally_conversations
        WHERE workspace_id = $1 AND telegram_user_id = $2
        ORDER BY created_at DESC LIMIT 20
      `, [workspaceId, String(userId)]);
      
      const messages = historyResult.rows.reverse().map(row => ({
        role: row.role,
        content: row.message
      }));
      
      // Get workspace memories for context
      let memoryContext = '';
      try {
        const memories = await pool.query(`
          SELECT content FROM memories
          WHERE workspace_id = $1
          ORDER BY created_at DESC
          LIMIT 10
        `, [workspaceId]);
        
        if (memories.rows.length > 0) {
          memoryContext = '\n\nRelevant memories about this user:\n' + 
            memories.rows.map(r => `- ${r.content}`).join('\n');
        }
      } catch (e) {
        // Memories table might not exist for all workspaces
      }
      
      const completion = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `You are Ally, a friendly and helpful personal AI assistant on Telegram. 
        
You're chatting with ${firstName}. Be warm, conversational, and helpful. 
Keep responses concise since this is a chat interface.
Use emoji occasionally to be friendly.
If they ask about features you don't have yet, be honest and say you're still learning.${memoryContext}`,
        messages
      });
      
      response = completion.content[0].text;
    } else {
      response = `Hello ${firstName}! 👋 I received your message, but my AI brain is still being set up. Check back soon!`;
    }
    
    // Store response
    await pool.query(`
      INSERT INTO ally_conversations (workspace_id, telegram_user_id, message, role, created_at)
      VALUES ($1, $2, $3, 'assistant', NOW())
    `, [workspaceId, String(userId), response]);
    
    // Track usage
    const today = new Date().toISOString().split('T')[0];
    await pool.query(`
      INSERT INTO ally_usage (workspace_id, date, messages_count)
      VALUES ($1, $2, 1)
      ON CONFLICT (workspace_id, date)
      DO UPDATE SET messages_count = ally_usage.messages_count + 1
    `, [workspaceId, today]);
    
    // Send response
    await sendTelegramMessage(chatId, response);
    
  } catch (error) {
    console.error('Message handling error:', error);
    await sendTelegramMessage(chatId,
      `⚠️ Sorry, I ran into an issue. Please try again in a moment.`
    );
  }
}

/**
 * POST /api/ally/setup-webhook
 * Setup Telegram webhook for Ally bot (admin endpoint)
 */
router.post('/setup-webhook', async (req, res) => {
  const { adminKey } = req.body;
  
  // Simple admin key check
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  if (!ALLY_BOT_TOKEN) {
    return res.status(400).json({ error: 'ALLY_BOT_TOKEN not configured' });
  }
  
  const BACKEND_URL = process.env.BACKEND_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  const webhookUrl = `${BACKEND_URL}/api/ally/webhook`;
  
  try {
    const response = await fetch(`${TELEGRAM_API}${ALLY_BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message'],
        drop_pending_updates: true
      })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      console.log(`✅ Ally webhook set to: ${webhookUrl}`);
      res.json({ success: true, webhookUrl });
    } else {
      res.status(400).json({ error: 'Failed to set webhook', details: data });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ally/webhook-info
 * Get current webhook info (admin endpoint)
 */
router.get('/webhook-info', async (req, res) => {
  if (!ALLY_BOT_TOKEN) {
    return res.status(400).json({ error: 'ALLY_BOT_TOKEN not configured' });
  }
  
  try {
    const response = await fetch(`${TELEGRAM_API}${ALLY_BOT_TOKEN}/getWebhookInfo`);
    const data = await response.json();
    res.json(data.result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
