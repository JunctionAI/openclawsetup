/**
 * Email System for Clawdbot SaaS
 * Handles transactional emails (welcome, alerts, billing)
 */

// Using Resend for email delivery (https://resend.com)
// Alternative: SendGrid, Postmark, AWS SES

const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_dummy_key';

/**
 * Send welcome email after successful signup
 */
async function sendWelcomeEmail(email, credentials) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 40px 20px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
    .credentials { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 20px; margin: 20px 0; }
    .credential-item { margin: 10px 0; }
    .credential-label { color: #6b7280; font-size: 14px; }
    .credential-value { font-family: monospace; background: #f3f4f6; padding: 8px; border-radius: 4px; margin-top: 4px; }
    .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">🎉 Welcome to Clawdbot!</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">Your AI assistant is ready to work</p>
    </div>
    
    <div class="content">
      <h2>Your Workspace is Live</h2>
      <p>Thanks for joining Clawdbot! Your personal AI assistant has been provisioned and is ready to help you stay organized, productive, and ahead of the game.</p>
      
      <div class="credentials">
        <h3 style="margin-top: 0;">Access Details</h3>
        
        <div class="credential-item">
          <div class="credential-label">Workspace ID</div>
          <div class="credential-value">${credentials.workspaceId}</div>
        </div>
        
        <div class="credential-item">
          <div class="credential-label">Access URL</div>
          <div class="credential-value"><a href="${credentials.accessUrl}">${credentials.accessUrl}</a></div>
        </div>
        
        <div class="credential-item">
          <div class="credential-label">API Key</div>
          <div class="credential-value">${credentials.apiKey}</div>
        </div>
      </div>
      
      <a href="${credentials.accessUrl}" class="button">Go to Dashboard →</a>
      
      <h3>Getting Started</h3>
      <ol>
        <li><strong>Connect your tools:</strong> Gmail, Calendar, Slack—all with one click</li>
        <li><strong>Talk to your assistant:</strong> Ask questions, set reminders, automate tasks</li>
        <li><strong>Explore features:</strong> Memory, web search, proactive monitoring</li>
      </ol>
      
      <h3>Need Help?</h3>
      <p>Check out our <a href="https://docs.setupclaw.com">documentation</a> or reply to this email with any questions. We're here to help!</p>
    </div>
    
    <div class="footer">
      <p>Clawdbot SaaS • Built for productivity</p>
      <p><a href="https://setupclaw.com">setupclaw.com</a> • <a href="mailto:support@setupclaw.com">support@setupclaw.com</a></p>
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `
Welcome to Clawdbot!

Your workspace is live and ready to use.

Access Details:
- Workspace ID: ${credentials.workspaceId}
- URL: ${credentials.accessUrl}
- API Key: ${credentials.apiKey}

Getting Started:
1. Connect your tools (Gmail, Calendar, etc.)
2. Talk to your assistant
3. Explore features

Visit: ${credentials.accessUrl}

Need help? Reply to this email or visit docs.setupclaw.com

---
Clawdbot SaaS
setupclaw.com
  `;

  return await sendEmail({
    to: email,
    subject: '🎉 Welcome to Clawdbot - Your Workspace is Ready!',
    html: htmlContent,
    text: textContent
  });
}

/**
 * Send payment failed notification
 */
async function sendPaymentFailedEmail(email, attemptNumber) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .alert { background: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; border-radius: 6px; }
    .button { display: inline-block; background: #ef4444; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="alert">
      <h2 style="margin-top: 0; color: #dc2626;">⚠️ Payment Failed</h2>
      <p>We tried to process your payment but it didn't go through. This was attempt ${attemptNumber} of 3.</p>
      <p>Please update your payment method to avoid service interruption.</p>
      <a href="https://setupclaw.com/billing" class="button">Update Payment Method</a>
    </div>
    
    <p style="color: #6b7280; font-size: 14px; margin-top: 40px;">
      Questions? Contact us at support@setupclaw.com
    </p>
  </div>
</body>
</html>
  `;

  return await sendEmail({
    to: email,
    subject: '⚠️ Payment Failed - Action Required',
    html: htmlContent
  });
}

/**
 * Send trial ending reminder
 */
async function sendTrialEndingEmail(email, daysRemaining) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .info { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="info">
      <h2 style="margin-top: 0; color: #1e40af;">⏰ Your Trial Ends in ${daysRemaining} Days</h2>
      <p>You've been using Clawdbot for almost 14 days now. Hope you're loving it!</p>
      <p>Your trial will end on [DATE]. After that, you'll be charged according to your selected plan.</p>
      <p>Want to make changes? You can upgrade, downgrade, or cancel anytime from your dashboard.</p>
    </div>
  </div>
</body>
</html>
  `;

  return await sendEmail({
    to: email,
    subject: `⏰ Your Clawdbot trial ends in ${daysRemaining} days`,
    html: htmlContent
  });
}

/**
 * Core email sending function
 */
async function sendEmail({ to, subject, html, text }) {
  console.log(`📧 Sending email to ${to}: ${subject}`);

  // TODO: Integrate with actual email service
  // For now, just log
  
  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_dummy_key') {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Clawdbot <hello@setupclaw.com>',
          to: [to],
          subject,
          html,
          text
        })
      });

      const data = await response.json();
      console.log('✅ Email sent:', data.id);
      return data;
    } catch (error) {
      console.error('❌ Email failed:', error);
      throw error;
    }
  } else {
    console.log('⚠️ Email service not configured (RESEND_API_KEY missing)');
    console.log('📧 Would send:', { to, subject });
    return { id: 'mock_' + Date.now() };
  }
}

module.exports = {
  sendWelcomeEmail,
  sendPaymentFailedEmail,
  sendTrialEndingEmail,
  sendEmail
};
