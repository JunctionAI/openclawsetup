/**
 * Email Module for Clawdbot SaaS
 * Handles transactional emails via Resend or similar
 * 
 * SEC-012 fix: Create email module that was previously missing
 */

// Use Resend, SendGrid, or similar in production
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@setupclaw.com';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@setupclaw.com';

/**
 * Send welcome email to new customer
 */
async function sendWelcomeEmail(email, credentials) {
  console.log(`📧 [EMAIL] Sending welcome email to ${email}`);
  
  const subject = 'Welcome to Clawdbot! 🚀 Your AI Assistant is Ready';
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #8B5CF6, #D946EF); padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .header h1 { color: white; margin: 0; font-size: 28px; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
    .credentials { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb; }
    .credential-item { margin: 10px 0; }
    .credential-label { font-weight: 600; color: #6b7280; font-size: 12px; text-transform: uppercase; }
    .credential-value { font-family: monospace; background: #f3f4f6; padding: 8px 12px; border-radius: 4px; margin-top: 4px; word-break: break-all; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #8B5CF6, #D946EF); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Clawdbot!</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">Your AI assistant that remembers everything</p>
    </div>
    
    <div class="content">
      <h2>🎉 You're all set!</h2>
      <p>Your Clawdbot workspace is ready. Here are your credentials:</p>
      
      <div class="credentials">
        <div class="credential-item">
          <div class="credential-label">Workspace ID</div>
          <div class="credential-value">${credentials.workspaceId}</div>
        </div>
        <div class="credential-item">
          <div class="credential-label">Access URL</div>
          <div class="credential-value">${credentials.accessUrl}</div>
        </div>
        <div class="credential-item">
          <div class="credential-label">API Key</div>
          <div class="credential-value">${credentials.apiKey.substring(0, 20)}...</div>
        </div>
      </div>
      
      <p><strong>⚠️ Keep your API key secret!</strong> Never share it publicly.</p>
      
      <center>
        <a href="${credentials.accessUrl}" class="cta-button">Open Your Dashboard →</a>
      </center>
      
      <h3>Quick Start</h3>
      <ol>
        <li>Click the button above to access your dashboard</li>
        <li>Connect your tools (Gmail, Calendar, Slack, etc.)</li>
        <li>Start chatting with your AI assistant!</li>
      </ol>
      
      <p>Need help? Reply to this email or visit our <a href="https://docs.setupclaw.com">documentation</a>.</p>
    </div>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} Clawdbot. All rights reserved.</p>
      <p>Questions? Contact us at ${SUPPORT_EMAIL}</p>
    </div>
  </div>
</body>
</html>
  `;

  const text = `
Welcome to Clawdbot!

Your AI assistant is ready. Here are your credentials:

Workspace ID: ${credentials.workspaceId}
Access URL: ${credentials.accessUrl}
API Key: ${credentials.apiKey.substring(0, 20)}...

⚠️ Keep your API key secret!

Quick Start:
1. Go to ${credentials.accessUrl}
2. Connect your tools (Gmail, Calendar, Slack, etc.)
3. Start chatting with your AI assistant!

Need help? Reply to this email or visit https://docs.setupclaw.com

© ${new Date().getFullYear()} Clawdbot
  `;

  try {
    if (RESEND_API_KEY) {
      // Use Resend API
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: email,
          subject,
          html,
          text,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Resend API error: ${error}`);
      }

      console.log(`✅ [EMAIL] Welcome email sent to ${email}`);
    } else {
      // Development: Log email content
      console.log(`📧 [EMAIL] (DEV MODE) Would send welcome email to ${email}`);
      console.log(`Subject: ${subject}`);
    }
  } catch (error) {
    console.error(`❌ [EMAIL] Failed to send welcome email:`, error.message);
    // Don't throw - email failure shouldn't break provisioning
  }
}

/**
 * Send payment failed notification
 */
async function sendPaymentFailedEmail(email, attemptNumber) {
  console.log(`📧 [EMAIL] Sending payment failed email to ${email} (attempt ${attemptNumber})`);

  const subject = attemptNumber >= 3 
    ? '⚠️ Your Clawdbot subscription has been suspended'
    : `⚠️ Payment failed - Action required (Attempt ${attemptNumber}/3)`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #DC2626; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
    .cta-button { display: inline-block; background: #8B5CF6; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }
    .warning { background: #FEF3C7; border: 1px solid #F59E0B; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ Payment Failed</h1>
    </div>
    
    <div class="content">
      <h2>We couldn't process your payment</h2>
      
      <p>Your recent payment for Clawdbot failed. This is attempt ${attemptNumber} of 3.</p>
      
      ${attemptNumber >= 3 ? `
      <div class="warning">
        <strong>Your account has been suspended.</strong> Update your payment method to restore access.
      </div>
      ` : `
      <div class="warning">
        <strong>Please update your payment method</strong> to avoid service interruption.
      </div>
      `}
      
      <p>Common reasons for payment failure:</p>
      <ul>
        <li>Expired credit card</li>
        <li>Insufficient funds</li>
        <li>Card declined by bank</li>
      </ul>
      
      <center>
        <a href="https://setupclaw.com/billing" class="cta-button">Update Payment Method →</a>
      </center>
      
      <p>If you believe this is an error, please contact us at ${SUPPORT_EMAIL}.</p>
    </div>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} Clawdbot. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    if (RESEND_API_KEY) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: email,
          subject,
          html,
        }),
      });

      if (!response.ok) {
        throw new Error(`Resend API error: ${await response.text()}`);
      }

      console.log(`✅ [EMAIL] Payment failed email sent to ${email}`);
    } else {
      console.log(`📧 [EMAIL] (DEV MODE) Would send payment failed email to ${email}`);
    }
  } catch (error) {
    console.error(`❌ [EMAIL] Failed to send payment failed email:`, error.message);
  }
}

/**
 * Send subscription cancelled email
 */
async function sendCancellationEmail(email) {
  console.log(`📧 [EMAIL] Sending cancellation email to ${email}`);

  const subject = 'Your Clawdbot subscription has been cancelled';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #6B7280; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
    .cta-button { display: inline-block; background: #8B5CF6; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>We're sorry to see you go</h1>
    </div>
    
    <div class="content">
      <h2>Your subscription has been cancelled</h2>
      
      <p>Your Clawdbot subscription has been cancelled. Your access will continue until the end of your current billing period.</p>
      
      <p>Your data will be retained for 30 days, after which it will be permanently deleted.</p>
      
      <h3>Changed your mind?</h3>
      <p>You can resubscribe anytime to restore your workspace and data.</p>
      
      <center>
        <a href="https://setupclaw.com/pricing" class="cta-button">Resubscribe →</a>
      </center>
      
      <p>We'd love to hear your feedback. What could we have done better? Reply to this email to let us know.</p>
    </div>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} Clawdbot. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: email,
          subject,
          html,
        }),
      });

      console.log(`✅ [EMAIL] Cancellation email sent to ${email}`);
    } else {
      console.log(`📧 [EMAIL] (DEV MODE) Would send cancellation email to ${email}`);
    }
  } catch (error) {
    console.error(`❌ [EMAIL] Failed to send cancellation email:`, error.message);
  }
}

module.exports = {
  sendWelcomeEmail,
  sendPaymentFailedEmail,
  sendCancellationEmail,
};
