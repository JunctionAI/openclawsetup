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
  await provisionCustomer(customerId, customerEmail, plan);
  
  // Send welcome email
  await sendWelcomeEmail(customerEmail, plan);
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
  
  // TODO: Send payment failed email
  // TODO: Suspend service after X failed attempts
}

// ========================================
// PROVISIONING SYSTEM
// ========================================

async function provisionCustomer(customerId, email, plan) {
  console.log('🚀 Provisioning customer:', email, 'Plan:', plan);
  
  // TODO: Implement actual provisioning
  // - Create Clawdbot instance
  // - Set up workspace
  // - Configure API keys
  // - Send credentials
  
  console.log('✅ Customer provisioned successfully');
}

async function sendWelcomeEmail(email, plan) {
  console.log('📧 Sending welcome email to:', email);
  
  // TODO: Implement email sending
  // Use SendGrid, Resend, or similar
  
  console.log('✅ Welcome email sent');
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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
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
