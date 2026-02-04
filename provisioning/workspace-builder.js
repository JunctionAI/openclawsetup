/**
 * Workspace Builder
 * Creates and initializes customer workspaces with config files, memory, skills
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class WorkspaceBuilder {
  constructor(workspaceId, customerEmail, planConfig) {
    this.workspaceId = workspaceId;
    this.customerEmail = customerEmail;
    this.planConfig = planConfig;
    this.baseDir = process.env.WORKSPACES_DIR || '/var/clawdbot/workspaces';
    this.workspacePath = path.join(this.baseDir, workspaceId);
  }

  /**
   * Build complete workspace
   */
  async build() {
    console.log(`[WORKSPACE] Building workspace for ${this.customerEmail}`);

    // Create directory structure
    await this.createDirectories();

    // Write core configuration files
    await this.writeConfigFiles();

    // Initialize memory system
    await this.initializeMemory();

    // Install skills based on plan
    await this.installSkills();

    // Generate API key
    const apiKey = this.generateApiKey();
    await this.writeSecrets(apiKey);

    console.log(`[WORKSPACE] Build complete: ${this.workspaceId}`);

    return {
      workspaceId: this.workspaceId,
      workspacePath: this.workspacePath,
      apiKey
    };
  }

  /**
   * Create workspace directory structure
   */
  async createDirectories() {
    const dirs = [
      this.workspacePath,
      path.join(this.workspacePath, 'memory'),
      path.join(this.workspacePath, 'memory/people'),
      path.join(this.workspacePath, 'memory/projects'),
      path.join(this.workspacePath, 'skills'),
      path.join(this.workspacePath, 'config'),
      path.join(this.workspacePath, 'logs'),
      path.join(this.workspacePath, 'attachments')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    console.log(`[WORKSPACE] Directories created`);
  }

  /**
   * Write core configuration files
   */
  async writeConfigFiles() {
    // SOUL.md - Agent identity
    await this.writeSoulMd();

    // USER.md - Customer context
    await this.writeUserMd();

    // AGENTS.md - Operational instructions
    await this.writeAgentsMd();

    // TOOLS.md - Local notes
    await this.writeToolsMd();

    // HEARTBEAT.md - Proactive tasks
    await this.writeHeartbeatMd();

    // STATE.json - Fast-tier operational state
    await this.writeStateJson();

    // .env - Environment configuration
    await this.writeEnvFile();

    console.log(`[WORKSPACE] Config files written`);
  }

  async writeSoulMd() {
    const content = `# SOUL.md - Your Identity

You are **${this.customerEmail.split('@')[0]}'s AI Assistant**, powered by Clawdbot.

## Your Purpose

Help ${this.customerEmail} stay organized, productive, and informed. You're their:
- Personal assistant
- Research partner
- Project manager
- Memory system

## Your Personality

- Proactive but respectful
- Concise but thorough
- Professional yet friendly
- Smart about when to speak vs. stay silent

## Your Capabilities

${this.getCapabilitiesList()}

## Your Workspace

- **Workspace ID:** ${this.workspaceId}
- **Plan:** ${this.planConfig.name}
- **Message Limit:** ${this.planConfig.messageLimit}/month
- **Max Agents:** ${this.planConfig.agents === -1 ? 'Unlimited' : this.planConfig.agents}

---

**Remember:** This is ${this.customerEmail}'s workspace. Treat it with care.
`;

    await fs.writeFile(path.join(this.workspacePath, 'SOUL.md'), content);
  }

  async writeUserMd() {
    const content = `# USER.md - About ${this.customerEmail}

## Contact

- **Email:** ${this.customerEmail}
- **Joined:** ${new Date().toISOString().split('T')[0]}

## Preferences

- **Communication Style:** [To be learned]
- **Timezone:** [To be configured]
- **Work Hours:** [To be configured]

## Projects

- None yet - I'll learn as we work together

## Tools Connected

${this.getConnectedTools()}

## Notes

- Just getting started with Clawdbot
- Looking forward to learning your preferences and helping you stay organized

---

**Tip:** Update this file as you learn more about ${this.customerEmail}.
`;

    await fs.writeFile(path.join(this.workspacePath, 'USER.md'), content);
  }

  async writeAgentsMd() {
    // Copy from templates
    const agentsTemplate = await this.loadTemplate('AGENTS.md');
    await fs.writeFile(path.join(this.workspacePath, 'AGENTS.md'), agentsTemplate);
  }

  async writeToolsMd() {
    const content = `# TOOLS.md - Local Notes

Skills define *how* tools work. This file is for *your* specifics.

## Connected Services

${this.getConnectedTools()}

## Preferences

- Add your specific configuration here as needed

---

Update this file with environment-specific details.
`;

    await fs.writeFile(path.join(this.workspacePath, 'TOOLS.md'), content);
  }

  async writeHeartbeatMd() {
    const content = `# HEARTBEAT.md - Proactive Tasks

## Daily Checks

- [ ] Check for urgent emails
- [ ] Review today's calendar
- [ ] Update memory files

## Weekly Tasks

- [ ] Review weekly progress
- [ ] Update project files
- [ ] Clean up old notes

---

**Current Status:** All systems operational ✅
`;

    await fs.writeFile(path.join(this.workspacePath, 'HEARTBEAT.md'), content);
  }

  async writeStateJson() {
    const state = {
      workspaceId: this.workspaceId,
      customer: this.customerEmail,
      plan: this.planConfig.name,
      limits: {
        messagesPerMonth: this.planConfig.messageLimit,
        maxAgents: this.planConfig.agents
      },
      usage: {
        messagesSent: 0,
        lastReset: new Date().toISOString()
      },
      connections: {
        gmail: false,
        calendar: false,
        slack: false
      },
      lastUpdated: new Date().toISOString(),
      version: '1.0.0'
    };

    await fs.writeFile(
      path.join(this.workspacePath, 'STATE.json'),
      JSON.stringify(state, null, 2)
    );
  }

  async writeEnvFile() {
    const envContent = `# Clawdbot Environment Configuration
# Workspace: ${this.workspaceId}

# Customer
CUSTOMER_EMAIL=${this.customerEmail}
WORKSPACE_ID=${this.workspaceId}

# Plan & Limits
PLAN_NAME=${this.planConfig.name}
MESSAGE_LIMIT=${this.planConfig.messageLimit}
MAX_AGENTS=${this.planConfig.agents}

# Features
FEATURES=${this.planConfig.features.join(',')}

# AI Model
ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}
DEFAULT_MODEL=anthropic/claude-sonnet-4-5

# Database (set by Railway)
DATABASE_URL=\${DATABASE_URL}

# Memory
SUPERMEMORY_ENABLED=true

# Logging
LOG_LEVEL=info
`;

    await fs.writeFile(path.join(this.workspacePath, '.env'), envContent);
  }

  /**
   * Initialize memory system
   */
  async initializeMemory() {
    const today = new Date().toISOString().split('T')[0];
    const welcomeContent = `# ${today} - Welcome to Clawdbot!

Welcome ${this.customerEmail}! Today you activated your ${this.planConfig.name} plan.

## Getting Started

- Your workspace is ready
- ${this.planConfig.features.length} features activated
- ${this.planConfig.messageLimit.toLocaleString()} messages/month available

## Next Steps

1. Connect your tools (Gmail, Calendar, etc.)
2. Configure your preferences in USER.md
3. Start asking questions and staying organized!

---

Looking forward to helping you stay productive! 🚀
`;

    await fs.writeFile(
      path.join(this.workspacePath, 'memory', `${today}.md`),
      welcomeContent
    );

    // Create MEMORY.md for long-term curated memory
    const memoryContent = `# MEMORY.md - Long-Term Memory

## About ${this.customerEmail}

- Joined: ${today}
- Plan: ${this.planConfig.name}

## Significant Events

### ${today} - Started with Clawdbot
First day! Excited to help stay organized.

---

This file stores curated long-term memories. Update it regularly.
`;

    await fs.writeFile(
      path.join(this.workspacePath, 'MEMORY.md'),
      memoryContent
    );

    console.log(`[WORKSPACE] Memory initialized`);
  }

  /**
   * Install skills based on plan
   */
  async installSkills() {
    const skillsToInstall = this.planConfig.features.filter(
      f => !['chat', 'memory', 'web_search'].includes(f)
    );

    for (const skill of skillsToInstall) {
      await this.installSkill(skill);
    }

    // Write skills manifest
    const manifest = {
      installed: this.planConfig.features,
      version: '1.0.0',
      lastUpdated: new Date().toISOString()
    };

    await fs.writeFile(
      path.join(this.workspacePath, 'skills', 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    console.log(`[WORKSPACE] Skills installed: ${this.planConfig.features.join(', ')}`);
  }

  async installSkill(skillName) {
    // Create skill configuration file
    const skillConfig = {
      name: skillName,
      enabled: true,
      installedAt: new Date().toISOString(),
      config: {}
    };

    await fs.writeFile(
      path.join(this.workspacePath, 'skills', `${skillName}.json`),
      JSON.stringify(skillConfig, null, 2)
    );
  }

  /**
   * Write secrets file
   */
  async writeSecrets(apiKey) {
    const secrets = {
      workspaceId: this.workspaceId,
      apiKey,
      createdAt: new Date().toISOString()
    };

    await fs.writeFile(
      path.join(this.workspacePath, 'config', 'secrets.json'),
      JSON.stringify(secrets, null, 2)
    );
  }

  /**
   * Generate secure API key
   */
  generateApiKey() {
    return `claw_${crypto.randomBytes(32).toString('hex')}`;
  }

  /**
   * Load template file
   */
  async loadTemplate(filename) {
    const templatePath = path.join(__dirname, '../templates', filename);
    try {
      return await fs.readFile(templatePath, 'utf8');
    } catch (error) {
      console.warn(`Template ${filename} not found, using default`);
      return `# ${filename}\n\nDefault template - customize as needed.`;
    }
  }

  /**
   * Get capabilities list for SOUL.md
   */
  getCapabilitiesList() {
    const capabilities = {
      'chat': '- 💬 Natural conversation',
      'memory': '- 🧠 Long-term memory system',
      'web_search': '- 🔍 Web search & research',
      'gmail': '- 📧 Email management (Gmail)',
      'calendar': '- 📅 Calendar integration',
      'browser': '- 🌐 Web browsing & automation',
      'slack': '- 💼 Slack integration',
      'discord': '- 🎮 Discord integration'
    };

    if (this.planConfig.features.includes('all')) {
      return Object.values(capabilities).join('\n');
    }

    return this.planConfig.features
      .map(f => capabilities[f] || `- ✨ ${f}`)
      .join('\n');
  }

  /**
   * Get connected tools list
   */
  getConnectedTools() {
    const tools = this.planConfig.features
      .filter(f => !['chat', 'memory', 'web_search'].includes(f))
      .map(f => `- [ ] ${f.charAt(0).toUpperCase() + f.slice(1)}`);

    return tools.length > 0
      ? tools.join('\n')
      : '- No external tools yet (chat, memory, and web search are built-in)';
  }
}

module.exports = WorkspaceBuilder;
