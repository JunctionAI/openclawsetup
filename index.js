const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// PAT-004 fix: Validate required environment variables at startup
const REQUIRED_ENV_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'DATABASE_URL'
];

const OPTIONAL_ENV_VARS = [
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',
  'RAILWAY_TOKEN',
  'NEON_API_KEY',
  'ENCRYPTION_KEY',    // For encrypting Telegram tokens (generate: openssl rand -hex 32)
  'BACKEND_URL',       // For Telegram webhook URL
  'TELEGRAM_BOT_TOKEN', // Multi-tenant Telegram bot token (ONE bot serves all users)
  'ALLY_BOT_TOKEN',    // Telegram bot token for @AllyBot (managed multi-tenant)
  'WEBSITE_URL',        // Frontend URL for signup links
  'ADMIN_SECRET',       // Secret for admin API endpoints
  'ADMIN_API_KEY'       // Admin API key for Ally setup endpoints
];

const missingRequired = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missingRequired.length > 0) {
  console.error('❌ Missing required environment variables:', missingRequired.join(', '));
  console.error('Please set these variables before starting the server.');
  process.exit(1);
}

const missingOptional = OPTIONAL_ENV_VARS.filter(v => !process.env[v]);
if (missingOptional.length > 0) {
  console.warn('⚠️ Missing optional environment variables:', missingOptional.join(', '));
  console.warn('Some features may not work without these.');
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for dashboard origins
app.use(cors({
  origin: [
    'https://clawdbotdashboard2.vercel.app',
    'https://clawdbotdashboard.vercel.app',
    'https://setupclaw.com',
    'https://app.setupclaw.com',
    'http://localhost:3000'
  ],
  credentials: true
}));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Stripe webhook - RAW body needed for signature verification
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('✅ Stripe event received:', event.type);

  // Handle different event types
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionChange(event.data.object);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        console.log('💰 Payment succeeded:', event.data.object.id);
        break;
      
      case 'invoice.payment_failed':
        console.log('❌ Payment failed:', event.data.object.id);
        await handlePaymentFailed(event.data.object);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Processing failed' });
  }

  res.json({ received: true });
});

// Other routes need JSON parser
app.use(express.json());

// Workspace API routes
const workspaceRouter = require('./api/workspace');
app.use('/api/workspace', workspaceRouter);

// Telegram API routes (legacy BYOB model)
const telegramRouter = require('./api/telegram');
app.use('/api/telegram', telegramRouter);

// Ally Bot routes (managed multi-tenant model)
const allyRouter = require('./api/ally');
app.use('/api/ally', allyRouter);

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'clawdbot-saas-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Database health check
app.get('/health/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', database: 'connected', time: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
  }
});

// Provisioning status API (for success page polling)
app.get('/api/status', async (req, res) => {
  const sessionId = req.query.session;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'session parameter required' });
  }
  
  try {
    // Get session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customerId = session.customer;
    
    // Check customer provisioning status
    const result = await pool.query(`
      SELECT workspace_id, instance_id, api_key, access_url, provisioned_at, status
      FROM customers
      WHERE stripe_customer_id = $1
    `, [customerId]);
    
    if (result.rows.length === 0) {
      return res.json({ status: 'processing', message: 'Payment confirmed, provisioning starting...' });
    }
    
    const customer = result.rows[0];
    
    if (customer.workspace_id && customer.access_url) {
      return res.json({
        status: 'provisioned',
        credentials: {
          workspaceId: customer.workspace_id,
          instanceId: customer.instance_id,
          apiKey: customer.api_key,
          accessUrl: customer.access_url
        }
      });
    } else {
      return res.json({ status: 'provisioning', message: 'Setting up your workspace...' });
    }
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// ========================================
// WEBHOOK HANDLERS
// ========================================

async function handleCheckoutCompleted(session) {
  console.log('🎉 New customer checkout completed:', session.id);
  
  const customerId = session.customer;
  const customerEmail = session.customer_details.email;
  const subscriptionId = session.subscription;
  
  // BUG-008 fix: Check for idempotency - prevent duplicate provisioning
  const existingCustomer = await pool.query(
    'SELECT workspace_id, provisioned_at FROM customers WHERE stripe_customer_id = $1',
    [customerId]
  );
  
  if (existingCustomer.rows.length > 0 && existingCustomer.rows[0].provisioned_at) {
    console.log(`⚠️ Customer ${customerId} already provisioned, skipping duplicate webhook`);
    return;
  }
  
  // Get subscription details
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const plan = subscription.items.data[0].price.id;
  
  // Store customer in database with checkout_session_id for idempotency tracking
  await pool.query(`
    INSERT INTO customers (stripe_customer_id, email, subscription_id, plan, status, checkout_session_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (stripe_customer_id) DO UPDATE
    SET subscription_id = $3, plan = $4, status = $5, checkout_session_id = $6, updated_at = NOW()
    WHERE customers.provisioned_at IS NULL
  `, [customerId, customerEmail, subscriptionId, plan, 'active', session.id]);
  
  console.log('✅ Customer stored in database:', customerEmail);
  
  // Trigger provisioning
  const credentials = await provisionCustomer(customerId, customerEmail, plan);
  
  // Send welcome email
  await sendWelcomeEmail(customerEmail, credentials);
}

async function handleSubscriptionChange(subscription) {
  console.log('🔄 Subscription updated:', subscription.id);
  
  const customerId = subscription.customer;
  const plan = subscription.items.data[0].price.id;
  const status = subscription.status;
  
  await pool.query(`
    UPDATE customers
    SET plan = $1, status = $2, updated_at = NOW()
    WHERE stripe_customer_id = $3
  `, [plan, status, customerId]);
  
  console.log('✅ Customer plan updated:', customerId);
}

async function handleSubscriptionCancelled(subscription) {
  console.log('❌ Subscription cancelled:', subscription.id);
  
  const customerId = subscription.customer;
  
  await pool.query(`
    UPDATE customers
    SET status = $1, updated_at = NOW()
    WHERE stripe_customer_id = $2
  `, ['cancelled', customerId]);
  
  // TODO: Deprovision customer resources
  console.log('⚠️ TODO: Deprovision customer:', customerId);
}

async function handlePaymentFailed(invoice) {
  console.log('⚠️ Payment failed for customer:', invoice.customer);
  
  const { sendPaymentFailedEmail } = require('./email');
  
  // Get customer email
  const result = await pool.query(
    'SELECT email FROM customers WHERE stripe_customer_id = $1',
    [invoice.customer]
  );
  
  if (result.rows.length > 0) {
    const email = result.rows[0].email;
    const attemptNumber = invoice.attempt_count || 1;
    
    await sendPaymentFailedEmail(email, attemptNumber);
    
    // Suspend service after 3 failed attempts
    if (attemptNumber >= 3) {
      await pool.query(
        'UPDATE customers SET status = $1 WHERE stripe_customer_id = $2',
        ['suspended', invoice.customer]
      );
      console.log('⚠️ Customer suspended due to payment failure:', invoice.customer);
    }
  }
}

// ========================================
// PROVISIONING SYSTEM
// ========================================

async function provisionCustomer(customerId, email, plan) {
  // Use REAL provisioning system (not mocks!)
  const { provisionCustomer: provision } = require('./provisioning/index-real');
  
  try {
    const credentials = await provision(customerId, email, plan);
    
    // Store credentials in database
    await pool.query(`
      UPDATE customers
      SET workspace_id = $1, 
          instance_id = $2, 
          api_key = $3, 
          access_url = $4,
          provisioned_at = NOW(),
          status = 'active'
      WHERE stripe_customer_id = $5
    `, [
      credentials.workspaceId,
      credentials.instanceId,
      credentials.apiKey,
      credentials.accessUrl,
      customerId
    ]);
    
    console.log('✅ Customer provisioned successfully:', credentials);
    return credentials;
  } catch (error) {
    console.error('❌ Provisioning failed:', error);
    
    // Mark customer as failed in database
    await pool.query(`
      UPDATE customers
      SET status = 'provisioning_failed'
      WHERE stripe_customer_id = $1
    `, [customerId]);
    
    throw error;
  }
}

async function sendWelcomeEmail(email, credentials) {
  const { sendWelcomeEmail: sendEmail } = require('./email');
  
  try {
    await sendEmail(email, credentials);
    console.log('✅ Welcome email sent to:', email);
  } catch (error) {
    console.error('❌ Failed to send welcome email:', error);
    // Don't fail provisioning if email fails
  }
}

// ========================================
// DATABASE INITIALIZATION
// ========================================

async function initDatabase() {
  try {
    // Customers table with improved schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        stripe_customer_id VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        subscription_id VARCHAR(255),
        plan VARCHAR(255),
        status VARCHAR(50),
        workspace_id VARCHAR(255) UNIQUE,
        instance_id VARCHAR(255),
        api_key VARCHAR(255),
        access_url VARCHAR(255),
        checkout_session_id VARCHAR(255),
        provisioned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Add missing columns if they don't exist (for existing databases)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='checkout_session_id') THEN
          ALTER TABLE customers ADD COLUMN checkout_session_id VARCHAR(255);
        END IF;
      END $$;
    `);
    
    // Conversations table with workspace isolation
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        workspace_id VARCHAR(255) NOT NULL,
        agent_id VARCHAR(255) DEFAULT 'main',
        channel VARCHAR(100) DEFAULT 'api',
        message TEXT NOT NULL,
        role VARCHAR(50) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Memories table for workspace memory
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id SERIAL PRIMARY KEY,
        workspace_id VARCHAR(255) NOT NULL,
        agent_id VARCHAR(255) DEFAULT 'main',
        content TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Usage tracking with composite unique constraint
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_tracking (
        id SERIAL PRIMARY KEY,
        workspace_id VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        messages_sent INT DEFAULT 0,
        api_calls INT DEFAULT 0,
        tokens_used BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(workspace_id, date)
      )
    `);
    
    // Telegram bots table for storing bot connections
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_bots (
        id SERIAL PRIMARY KEY,
        workspace_id VARCHAR(255) UNIQUE NOT NULL,
        bot_id VARCHAR(100) NOT NULL,
        bot_username VARCHAR(100),
        bot_name VARCHAR(255),
        token_encrypted TEXT NOT NULL,
        webhook_url VARCHAR(500),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_telegram_bots_workspace 
      ON telegram_bots(workspace_id)
    `);
    
    // ========================================
    // ALLY BOT TABLES (Managed Multi-tenant)
    // ========================================
    
    // Ally workspaces (one per user)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ally_workspaces (
        id VARCHAR(255) PRIMARY KEY,
        link_code VARCHAR(10) UNIQUE NOT NULL,
        api_key VARCHAR(255) UNIQUE,
        plan VARCHAR(50) DEFAULT 'free',
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Ally users (Google-authenticated)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ally_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        google_id VARCHAR(255),
        workspace_id VARCHAR(255) REFERENCES ally_workspaces(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Telegram links (maps Telegram user ID to workspace)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ally_telegram_links (
        id SERIAL PRIMARY KEY,
        workspace_id VARCHAR(255) REFERENCES ally_workspaces(id),
        telegram_user_id VARCHAR(100) UNIQUE NOT NULL,
        telegram_username VARCHAR(100),
        telegram_first_name VARCHAR(255),
        telegram_chat_id VARCHAR(100),
        linked_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Ally conversations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ally_conversations (
        id SERIAL PRIMARY KEY,
        workspace_id VARCHAR(255) NOT NULL,
        telegram_user_id VARCHAR(100),
        message TEXT NOT NULL,
        role VARCHAR(50) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Ally usage tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ally_usage (
        id SERIAL PRIMARY KEY,
        workspace_id VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        messages_count INT DEFAULT 0,
        UNIQUE(workspace_id, date)
      )
    `);
    
    // Indexes for Ally tables
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ally_users_email ON ally_users(email)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ally_telegram_links_user 
      ON ally_telegram_links(telegram_user_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ally_conversations_workspace 
      ON ally_conversations(workspace_id, created_at DESC)
    `);
    
    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_workspace 
      ON conversations(workspace_id, created_at DESC)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_memories_workspace 
      ON memories(workspace_id, created_at DESC)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_workspace_date 
      ON usage_tracking(workspace_id, date)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_customers_workspace 
      ON customers(workspace_id)
    `);
    
    console.log('✅ Database schema initialized');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
  }
}

// ========================================
// START SERVER
// ========================================

app.listen(PORT, async () => {
  console.log(`🚀 Clawdbot SaaS backend running on port ${PORT}`);
  await initDatabase();
  console.log('✅ Ready to accept webhooks');
});
