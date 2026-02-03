const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'clawdbot-saas-backend',
    version: '1.0.0'
  });
});

// Stripe webhook endpoint (placeholder)
app.post('/webhook/stripe', (req, res) => {
  console.log('Stripe webhook received');
  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Clawdbot SaaS backend running on port ${PORT}`);
});
