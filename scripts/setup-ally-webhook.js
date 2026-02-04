#!/usr/bin/env node
/**
 * Setup Ally Bot Telegram Webhook
 * 
 * Run this script to configure the @AllyBot Telegram webhook.
 * Usage: ALLY_BOT_TOKEN=xxx BACKEND_URL=xxx node scripts/setup-ally-webhook.js
 */

require('dotenv').config();

const ALLY_BOT_TOKEN = process.env.ALLY_BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
  : null;

async function main() {
  console.log('🤖 Ally Bot Webhook Setup\n');
  
  if (!ALLY_BOT_TOKEN) {
    console.error('❌ ALLY_BOT_TOKEN environment variable is required');
    console.error('   Get it from @BotFather on Telegram');
    process.exit(1);
  }
  
  if (!BACKEND_URL) {
    console.error('❌ BACKEND_URL environment variable is required');
    console.error('   Example: https://your-backend.railway.app');
    process.exit(1);
  }
  
  const webhookUrl = `${BACKEND_URL}/api/ally/webhook`;
  
  console.log(`📍 Setting webhook URL: ${webhookUrl}\n`);
  
  try {
    // Get bot info first
    const meResponse = await fetch(`https://api.telegram.org/bot${ALLY_BOT_TOKEN}/getMe`);
    const meData = await meResponse.json();
    
    if (!meData.ok) {
      throw new Error(meData.description || 'Invalid bot token');
    }
    
    console.log(`✅ Bot found: @${meData.result.username} (${meData.result.first_name})`);
    
    // Set webhook
    const webhookResponse = await fetch(`https://api.telegram.org/bot${ALLY_BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message'],
        drop_pending_updates: true
      })
    });
    
    const webhookData = await webhookResponse.json();
    
    if (!webhookData.ok) {
      throw new Error(webhookData.description || 'Failed to set webhook');
    }
    
    console.log(`✅ Webhook set successfully!\n`);
    
    // Verify webhook
    const infoResponse = await fetch(`https://api.telegram.org/bot${ALLY_BOT_TOKEN}/getWebhookInfo`);
    const infoData = await infoResponse.json();
    
    console.log('📋 Webhook Info:');
    console.log(`   URL: ${infoData.result.url}`);
    console.log(`   Pending updates: ${infoData.result.pending_update_count}`);
    console.log(`   Last error: ${infoData.result.last_error_message || 'None'}`);
    
    console.log('\n🎉 Ally bot is ready to receive messages!');
    console.log(`   Send /start to @${meData.result.username} to test.`);
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main();
