/**
 * AI Chat Handler - Improved implementation
 * Works without requiring Clawdbot CLI installed on server
 */

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');

// Initialize AI clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Get workspace context (memory files, user info, etc.)
 */
async function getWorkspaceContext(workspacePath) {
  const context = {
    memory: '',
    user: '',
    soul: '',
    recentConversations: []
  };

  try {
    // Read USER.md
    const userPath = path.join(workspacePath, 'USER.md');
    if (await fileExists(userPath)) {
      context.user = await fs.readFile(userPath, 'utf8');
    }

    // Read SOUL.md
    const soulPath = path.join(workspacePath, 'SOUL.md');
    if (await fileExists(soulPath)) {
      context.soul = await fs.readFile(soulPath, 'utf8');
    }

    // Read MEMORY.md
    const memoryPath = path.join(workspacePath, 'MEMORY.md');
    if (await fileExists(memoryPath)) {
      context.memory = await fs.readFile(memoryPath, 'utf8');
    }

    // Read recent daily memory files
    const memoryDir = path.join(workspacePath, 'memory');
    if (await fileExists(memoryDir)) {
      const files = await fs.readdir(memoryDir);
      const recentFiles = files
        .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
        .sort()
        .slice(-3); // Last 3 days

      for (const file of recentFiles) {
        const content = await fs.readFile(path.join(memoryDir, file), 'utf8');
        context.recentConversations.push({ date: file.replace('.md', ''), content });
      }
    }
  } catch (error) {
    console.error('Error loading workspace context:', error);
  }

  return context;
}

/**
 * Build system prompt from workspace context
 */
function buildSystemPrompt(context, plan) {
  const limits = getPlanLimits(plan);
  
  return `You are a personal AI assistant with perfect memory. You remember everything about the user.

## About the User
${context.user || 'No user information available yet. Ask the user to tell you about themselves.'}

## Your Personality
${context.soul || 'Be helpful, friendly, and professional.'}

## Your Memory
You have access to the following memory:
${context.memory || 'No long-term memory stored yet.'}

## Recent Context
${context.recentConversations.map(c => `### ${c.date}\n${c.content}`).join('\n\n') || 'No recent conversations.'}

## Your Capabilities
- Plan: ${plan}
- Message limit: ${limits.messages}/month
- Available integrations: ${limits.integrations.join(', ')}

## Instructions
1. Always reference and use your memory when relevant
2. Remember new information the user shares
3. Be proactive in offering help
4. Keep responses concise but thorough
5. If you learn something new about the user, acknowledge it`;
}

/**
 * Get plan limits
 */
function getPlanLimits(plan) {
  const plans = {
    'Starter': {
      messages: 5000,
      integrations: ['chat', 'memory', 'web_search']
    },
    'Pro': {
      messages: 20000,
      integrations: ['chat', 'memory', 'web_search', 'gmail', 'calendar', 'browser']
    },
    'Team': {
      messages: 100000,
      integrations: ['all']
    }
  };
  return plans[plan] || plans['Starter'];
}

/**
 * Chat with AI
 */
async function chat(workspaceId, message, options = {}) {
  const workspacePath = path.join('./workspaces', workspaceId);
  const model = options.model || 'claude-3-sonnet-20240229';
  const plan = options.plan || 'Starter';

  // Get workspace context
  const context = await getWorkspaceContext(workspacePath);
  const systemPrompt = buildSystemPrompt(context, plan);

  // Build conversation history
  const messages = [
    { role: 'user', content: message }
  ];

  let response;

  // Use Claude (preferred) or fall back to OpenAI
  if (process.env.ANTHROPIC_API_KEY) {
    const completion = await anthropic.messages.create({
      model: model.startsWith('claude') ? model : 'claude-3-sonnet-20240229',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    response = completion.content[0].text;
  } else if (process.env.OPENAI_API_KEY) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ]
    });

    response = completion.choices[0].message.content;
  } else {
    throw new Error('No AI API key configured');
  }

  // Save to daily memory
  await saveToMemory(workspacePath, message, response);

  return {
    response,
    model: model,
    memory_updated: true
  };
}

/**
 * Save conversation to daily memory file
 */
async function saveToMemory(workspacePath, userMessage, assistantResponse) {
  try {
    const memoryDir = path.join(workspacePath, 'memory');
    await fs.mkdir(memoryDir, { recursive: true });

    const today = new Date().toISOString().split('T')[0];
    const memoryFile = path.join(memoryDir, `${today}.md`);

    const timestamp = new Date().toLocaleTimeString('en-NZ', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const entry = `\n### ${timestamp}\n**User:** ${userMessage}\n**Assistant:** ${assistantResponse}\n`;

    await fs.appendFile(memoryFile, entry);
  } catch (error) {
    console.error('Error saving to memory:', error);
  }
}

/**
 * Check if file exists
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  chat,
  getWorkspaceContext,
  buildSystemPrompt
};
