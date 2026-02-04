/**
 * 14-Day Onboarding Email Sequence
 * Maximizes trial → paid conversion
 */

const { sendEmail } = require('./index');

// Day 0: Welcome (immediately after signup)
async function sendWelcomeEmail(email, credentials) {
  // Already implemented in email/index.js
}

// Day 1: Getting Started Guide
async function sendDay1Email(email, workspaceId) {
  const subject = "🚀 Quick Start: Connect Your First Tool";
  const html = `
    <h2>Ready to supercharge your workflow?</h2>
    <p>Here's how to get the most out of Clawdbot in the next 5 minutes:</p>
    
    <h3>Step 1: Connect Gmail</h3>
    <p>Let Clawdbot monitor your inbox and summarize important emails.</p>
    <a href="https://app.setupclaw.com/${workspaceId}/integrations">Connect Gmail →</a>
    
    <h3>Step 2: Try Your First Command</h3>
    <p>Ask: "What's on my calendar today?" or "Summarize my unread emails"</p>
    
    <h3>Step 3: Set Up a Reminder</h3>
    <p>Try: "Remind me to follow up with Sarah tomorrow at 2pm"</p>
    
    <p><strong>Pro Tip:</strong> Clawdbot learns from every interaction. The more you use it, the smarter it gets!</p>
  `;
  
  return await sendEmail({ to: email, subject, html });
}

// Day 3: Feature Highlight - Memory
async function sendDay3Email(email) {
  const subject = "💡 Why Clawdbot Remembers Everything (And ChatGPT Doesn't)";
  const html = `
    <h2>The Power of Perfect Memory</h2>
    <p>Unlike ChatGPT, Clawdbot never forgets:</p>
    <ul>
      <li>Your preferences and working style</li>
      <li>Past conversations and decisions</li>
      <li>Project context and goals</li>
      <li>Recurring tasks and reminders</li>
    </ul>
    
    <p><strong>Try This:</strong> Tell Clawdbot about your current projects. It'll remember and help you stay on track.</p>
    
    <p>Example: "I'm working on launching a SaaS product. Help me stay organized and track my progress."</p>
  `;
  
  return await sendEmail({ to: email, subject, html });
}

// Day 5: Social Proof + Case Study
async function sendDay5Email(email) {
  const subject = "📊 How Sarah Saved 10 Hours/Week With Clawdbot";
  const html = `
    <h2>Real Results From Real Users</h2>
    <p>"Clawdbot handles my email triage, calendar management, and follow-ups automatically. I've reclaimed 2 hours every single day." - Sarah Chen, Product Manager</p>
    
    <h3>What Sarah Automated:</h3>
    <ul>
      <li>Daily email summaries (30 min saved)</li>
      <li>Meeting prep reminders (20 min saved)</li>
      <li>Task tracking & follow-ups (45 min saved)</li>
      <li>Research & web scraping (35 min saved)</li>
    </ul>
    
    <p><strong>Your Turn:</strong> What could YOU automate with an extra 10 hours/week?</p>
  `;
  
  return await sendEmail({ to: email, subject, html });
}

// Day 7: Mid-Trial Check-In
async function sendDay7Email(email, workspaceId) {
  const subject = "⏰ Halfway Through Your Trial - Let's Make It Count";
  const html = `
    <h2>You're Halfway There!</h2>
    <p>7 days left in your free trial. Here's how to maximize the rest:</p>
    
    <h3>Advanced Features You Might Have Missed:</h3>
    <ul>
      <li><strong>Proactive Monitoring:</strong> Clawdbot can check your email/calendar automatically</li>
      <li><strong>Browser Automation:</strong> Scrape websites, fill forms, automate research</li>
      <li><strong>Multi-Agent Workflows:</strong> Spawn sub-agents for parallel tasks</li>
    </ul>
    
    <p><a href="https://docs.setupclaw.com/advanced">View Advanced Guide →</a></p>
    
    <p>Need help? Reply to this email - we respond within hours!</p>
  `;
  
  return await sendEmail({ to: email, subject, html });
}

// Day 10: Urgency + Upgrade Incentive
async function sendDay10Email(email) {
  const subject = "🎁 Special Offer: Lock In Your Rate (4 Days Left)";
  const html = `
    <h2>Your Trial Ends Soon - Don't Lose Your Data!</h2>
    <p>In 4 days, your trial expires. Here's what happens:</p>
    <ul>
      <li>❌ Access to your workspace paused</li>
      <li>❌ All your memory & context frozen</li>
      <li>❌ Integrations disconnected</li>
    </ul>
    
    <h3>Special Launch Offer (This Week Only):</h3>
    <p><strong>Upgrade now and get 20% off your first 3 months!</strong></p>
    <p>Use code: <code>EARLYBIRD20</code></p>
    
    <a href="https://app.setupclaw.com/upgrade">Upgrade Now →</a>
    
    <p><small>*Offer expires when your trial ends</small></p>
  `;
  
  return await sendEmail({ to: email, subject, html });
}

// Day 13: Final Push - Trial Ending
async function sendDay13Email(email) {
  const subject = "⚠️ FINAL REMINDER: Your Trial Ends Tomorrow";
  const html = `
    <h2 style="color: #ef4444;">Your Trial Expires in 24 Hours</h2>
    <p>This is your last chance to keep access to:</p>
    <ul>
      <li>Your personalized AI assistant</li>
      <li>All your memory & conversation history</li>
      <li>Connected integrations (Gmail, Calendar, etc.)</li>
      <li>Saved preferences & automations</li>
    </ul>
    
    <p><strong>Don't start over.</strong> Upgrade now and everything stays exactly as you left it.</p>
    
    <a href="https://app.setupclaw.com/upgrade" style="background: #8b5cf6; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
      Keep My Workspace →
    </a>
    
    <p style="margin-top: 30px; color: #6b7280;">Not ready yet? Reply and let us know what's holding you back.</p>
  `;
  
  return await sendEmail({ to: email, subject, html });
}

// Day 14: Trial Ended - Win-Back Sequence
async function sendTrialEndedEmail(email) {
  const subject = "Your Workspace is Paused - Reactivate Anytime";
  const html = `
    <h2>We'll Keep Your Data Safe</h2>
    <p>Your trial has ended, but we're keeping your workspace for 30 days in case you want to come back.</p>
    
    <p><strong>Everything is preserved:</strong></p>
    <ul>
      <li>✓ Your memory & conversation history</li>
      <li>✓ Workspace files & settings</li>
      <li>✓ Integration connections</li>
    </ul>
    
    <p>Reactivate anytime with one click - no setup required.</p>
    
    <a href="https://app.setupclaw.com/reactivate">Reactivate My Workspace →</a>
    
    <p style="margin-top: 30px;">
      <strong>Changed your mind?</strong> Tell us why: <a href="mailto:support@setupclaw.com">support@setupclaw.com</a>
    </p>
  `;
  
  return await sendEmail({ to: email, subject, html });
}

module.exports = {
  sendWelcomeEmail,
  sendDay1Email,
  sendDay3Email,
  sendDay5Email,
  sendDay7Email,
  sendDay10Email,
  sendDay13Email,
  sendTrialEndedEmail
};
