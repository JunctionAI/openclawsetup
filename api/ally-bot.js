/**
 * Multi-tenant Ally Bot - Single bot serves all users
 * Messages routed based on Telegram user ID
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const TELEGRAM_BOT_TOKEN = process.env.ALLY_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

/**
 * Webhook endpoint - receives ALL messages to @AllyAIBot
 */
router.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    // Handle message
    if (update.message) {
      await handleMessage(update.message);
    }
    
    // Handle callback queries (button clicks)
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
    
    res.json({ ok: true });
  } catch (error) {
    console.error('[ALLY] Webhook error:', error);
    res.json({ ok: true }); // Always return 200 to Telegram
  }
});

/**
 * Handle incoming message
 */
async function handleMessage(message) {
  const telegramId = message.from.id.toString();
  const chatId = message.chat.id;
  const text = message.text || '';
  const firstName = message.from.first_name || 'there';

  console.log(`[ALLY] Message from ${telegramId}: ${text.substring(0, 50)}...`);

  // Handle /start command with link code
  if (text.startsWith('/start')) {
    const linkCode = text.split(' ')[1];
    if (linkCode && linkCode.startsWith('ALLY-')) {
      await handleLinkCode(chatId, telegramId, linkCode, firstName);
      return;
    }
    await sendWelcome(chatId, firstName);
    return;
  }

  // Look up user
  const user = await getUserByTelegramId(telegramId);
  
  if (!user) {
    // Not linked - prompt to sign up
    await sendTelegram(chatId, 
      `👋 Hi ${firstName}! I'm Ally, your AI assistant.\n\n` +
      `To get started, sign up at:\n` +
      `🔗 https://ally.clawdbot.com/setup\n\n` +
      `Already have an account? Link it by sending your code.`
    );
    return;
  }

  // User is linked - process message
  await processMessage(chatId, user, text);
}

/**
 * Handle link code from /start deep link
 */
async function handleLinkCode(chatId, telegramId, linkCode, firstName) {
  try {
    // Find pending link by code
    const result = await pool.query(
      'SELECT id, email FROM users WHERE link_code = $1 AND telegram_id IS NULL',
      [linkCode]
    );

    if (result.rows.length === 0) {
      await sendTelegram(chatId,
        `❌ Invalid or expired link code.\n\n` +
        `Get a new code at: https://ally.clawdbot.com/setup`
      );
      return;
    }

    // Link the account
    await pool.query(
      'UPDATE users SET telegram_id = $1, telegram_chat_id = $2, linked_at = NOW() WHERE id = $3',
      [telegramId, chatId.toString(), result.rows[0].id]
    );

    await sendTelegram(chatId,
      `✅ Account linked!\n\n` +
      `Hey ${firstName}! I'm Ally, your AI assistant. I can:\n\n` +
      `• Answer questions & research\n` +
      `• Help with writing & editing\n` +
      `• Remember our conversations\n` +
      `• Learn your preferences\n\n` +
      `Just send me a message to get started!`
    );

    console.log(`[ALLY] Linked ${telegramId} to user ${result.rows[0].id}`);
  } catch (error) {
    console.error('[ALLY] Link error:', error);
    await sendTelegram(chatId, `❌ Something went wrong. Please try again.`);
  }
}

/**
 * Process message for linked user
 */
async function processMessage(chatId, user, text) {
  // Send typing indicator
  await sendTyping(chatId);

  try {
    // Get conversation history (last 10 messages)
    const history = await getConversationHistory(user.id, 10);
    
    // Build messages array
    const messages = [
      ...history.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: text }
    ];

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: user.model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are Ally, a helpful AI assistant. You're friendly, concise, and actually useful.
        
User info:
- Name: ${user.name || 'Friend'}
- Email: ${user.email}

Be conversational but efficient. Remember context from previous messages. Don't be overly formal.`,
        messages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[ALLY] Claude error:', error);
      await sendTelegram(chatId, `Sorry, I encountered an error. Please try again.`);
      return;
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || "I couldn't generate a response.";

    // Store conversation
    await storeMessage(user.id, 'user', text);
    await storeMessage(user.id, 'assistant', reply);

    // Send response (split if too long)
    await sendLongMessage(chatId, reply);

  } catch (error) {
    console.error('[ALLY] Process error:', error);
    await sendTelegram(chatId, `Sorry, something went wrong. Please try again.`);
  }
}

/**
 * Get user by Telegram ID
 */
async function getUserByTelegramId(telegramId) {
  const result = await pool.query(
    'SELECT id, email, name, model, plan FROM users WHERE telegram_id = $1',
    [telegramId]
  );
  return result.rows[0] || null;
}

/**
 * Get conversation history
 */
async function getConversationHistory(userId, limit = 10) {
  const result = await pool.query(
    `SELECT role, content FROM messages 
     WHERE user_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.reverse();
}

/**
 * Store message in history
 */
async function storeMessage(userId, role, content) {
  await pool.query(
    'INSERT INTO messages (user_id, role, content, created_at) VALUES ($1, $2, $3, NOW())',
    [userId, role, content]
  );
}

/**
 * Send welcome message
 */
async function sendWelcome(chatId, firstName) {
  await sendTelegram(chatId,
    `👋 Hey ${firstName}! I'm Ally, your AI assistant.\n\n` +
    `To get started:\n` +
    `1️⃣ Sign up at ally.clawdbot.com/setup\n` +
    `2️⃣ Get your link code\n` +
    `3️⃣ Send it here to connect\n\n` +
    `Or if you have a code, just send it now!`
  );
}

/**
 * Send message via Telegram API
 */
async function sendTelegram(chatId, text, options = {}) {
  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options
    })
  });
  return response.json();
}

/**
 * Send long message (split if > 4096 chars)
 */
async function sendLongMessage(chatId, text) {
  const maxLength = 4000; // Leave buffer for Telegram
  
  if (text.length <= maxLength) {
    await sendTelegram(chatId, text);
    return;
  }

  // Split by paragraphs or sentences
  const chunks = [];
  let current = '';
  
  for (const paragraph of text.split('\n\n')) {
    if ((current + '\n\n' + paragraph).length > maxLength) {
      if (current) chunks.push(current);
      current = paragraph;
    } else {
      current = current ? current + '\n\n' + paragraph : paragraph;
    }
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    await sendTelegram(chatId, chunk);
  }
}

/**
 * Send typing indicator
 */
async function sendTyping(chatId) {
  await fetch(`${TELEGRAM_API}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      action: 'typing'
    })
  });
}

/**
 * Handle callback query (button clicks)
 */
async function handleCallback(query) {
  // Acknowledge the callback
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: query.id })
  });
}

/**
 * Set webhook for the bot
 */
router.post('/set-webhook', async (req, res) => {
  const webhookUrl = req.body.url || `${process.env.BACKEND_URL}/api/ally/webhook`;
  
  const response = await fetch(`${TELEGRAM_API}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl })
  });
  
  const result = await response.json();
  res.json(result);
});

module.exports = router;
