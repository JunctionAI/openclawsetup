const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

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
  
  // Get subscription details
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const plan = subscription.items.data[0].price.id;
  
  // Store customer in database
  await pool.query(`
    INSERT INTO customers (stripe_customer_id, email, subscription_id, plan, status, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (stripe_customer_id) DO UPDATE
    SET subscription_id = $3, plan = $4, status = $5, updated_at = NOW()
  `, [customerId, customerEmail, subscriptionId, plan, 'active']);
  
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        stripe_customer_id VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        subscription_id VARCHAR(255),
        plan VARCHAR(255),
        status VARCHAR(50),
        workspace_id VARCHAR(255),
        instance_id VARCHAR(255),
        api_key VARCHAR(255),
        access_url VARCHAR(255),
        provisioned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        workspace_id VARCHAR(255) NOT NULL,
        user_message TEXT NOT NULL,
        assistant_response TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_workspace 
      ON conversations(workspace_id, created_at DESC)
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
