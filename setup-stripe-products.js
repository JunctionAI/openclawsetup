/**
 * Stripe Product & Price Setup
 * Run once to create products and pricing tiers
 * 
 * Usage: node setup-stripe-products.js
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function setupProducts() {
  console.log('🔧 Setting up Stripe products...\n');

  // Create Products
  const starter = await stripe.products.create({
    name: 'Starter',
    description: 'Perfect for individuals getting started with AI automation',
    metadata: {
      messageLimit: '5000',
      agents: '3',
      features: 'chat,memory,web_search'
    }
  });
  console.log('✅ Created product: Starter');

  const pro = await stripe.products.create({
    name: 'Pro',
    description: 'For power users who need advanced integrations',
    metadata: {
      messageLimit: '20000',
      agents: '10',
      features: 'all_starter,gmail,calendar,browser'
    }
  });
  console.log('✅ Created product: Pro');

  const team = await stripe.products.create({
    name: 'Team',
    description: 'For teams who want shared workspaces',
    metadata: {
      messageLimit: '100000',
      agents: 'unlimited',
      features: 'all_pro,team_seats,shared_workspaces'
    }
  });
  console.log('✅ Created product: Team\n');

  // Create Prices (Monthly Subscriptions)
  const starterPrice = await stripe.prices.create({
    product: starter.id,
    unit_amount: 2900, // $29.00
    currency: 'usd',
    recurring: {
      interval: 'month',
      trial_period_days: 14
    }
  });
  console.log(`✅ Created price: Starter - $29/month (${starterPrice.id})`);

  const proPrice = await stripe.prices.create({
    product: pro.id,
    unit_amount: 7900, // $79.00
    currency: 'usd',
    recurring: {
      interval: 'month',
      trial_period_days: 14
    }
  });
  console.log(`✅ Created price: Pro - $79/month (${proPrice.id})`);

  const teamPrice = await stripe.prices.create({
    product: team.id,
    unit_amount: 19900, // $199.00
    currency: 'usd',
    recurring: {
      interval: 'month',
      trial_period_days: 14
    }
  });
  console.log(`✅ Created price: Team - $199/month (${teamPrice.id})\n`);

  // Output summary
  console.log('📋 Summary - Update your frontend with these price IDs:\n');
  console.log(`Starter: ${starterPrice.id}`);
  console.log(`Pro:     ${proPrice.id}`);
  console.log(`Team:    ${teamPrice.id}\n`);
  
  console.log('✅ All done! Products and prices are live in Stripe.');
}

setupProducts().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
