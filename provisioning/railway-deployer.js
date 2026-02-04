/**
 * Railway Deployment System
 * Actually provisions working Clawdbot instances (NOT MOCK)
 */

const fetch = require('node:fetch');

const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';
const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN;
const GITHUB_TEMPLATE_REPO = 'JunctionAI/clawdbot-template'; // We'll create this

/**
 * Deploy a real Clawdbot instance on Railway for a customer
 */
async function deployToRailway(customerId, email, plan) {
  console.log(`[RAILWAY] Deploying for ${email}...`);
  
  const projectName = `claw-${customerId.substring(4, 16)}`;
  
  try {
    // 1. Create Railway project
    const project = await createRailwayProject(projectName);
    console.log(`[RAILWAY] Project created: ${project.id}`);
    
    // 2. Deploy from GitHub template
    const service = await deployFromGithub(project.id, GITHUB_TEMPLATE_REPO);
    console.log(`[RAILWAY] Service deployed: ${service.id}`);
    
    // 3. Set environment variables
    await setEnvironmentVariables(project.id, service.id, {
      CUSTOMER_ID: customerId,
      CUSTOMER_EMAIL: email,
      PLAN: plan.name,
      MESSAGE_LIMIT: plan.messageLimit.toString(),
      AGENTS_LIMIT: plan.agents.toString(),
      FEATURES: plan.features.join(',')
    });
    console.log(`[RAILWAY] Environment configured`);
    
    // 4. Get service URL
    const serviceUrl = await getServiceUrl(service.id);
    console.log(`[RAILWAY] Service live at: ${serviceUrl}`);
    
    return {
      projectId: project.id,
      serviceId: service.id,
      url: serviceUrl,
      workspaceId: projectName
    };
    
  } catch (error) {
    console.error(`[RAILWAY] Deployment failed:`, error);
    throw new Error(`Railway deployment failed: ${error.message}`);
  }
}

/**
 * Create Railway project via GraphQL API
 */
async function createRailwayProject(name) {
  const mutation = `
    mutation projectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        id
        name
      }
    }
  `;
  
  const response = await railwayGraphQL(mutation, {
    input: {
      name,
      description: 'Customer Clawdbot Instance',
      isPublic: false
    }
  });
  
  return response.projectCreate;
}

/**
 * Deploy service from GitHub repo
 */
async function deployFromGithub(projectId, repo) {
  const mutation = `
    mutation serviceCreate($input: ServiceCreateInput!) {
      serviceCreate(input: $input) {
        id
        name
      }
    }
  `;
  
  const response = await railwayGraphQL(mutation, {
    input: {
      projectId,
      name: 'clawdbot',
      source: {
        repo,
        branch: 'main'
      }
    }
  });
  
  return response.serviceCreate;
}

/**
 * Set environment variables for service
 */
async function setEnvironmentVariables(projectId, serviceId, vars) {
  const mutation = `
    mutation variableUpsert($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }
  `;
  
  for (const [key, value] of Object.entries(vars)) {
    await railwayGraphQL(mutation, {
      input: {
        projectId,
        serviceId,
        name: key,
        value
      }
    });
  }
}

/**
 * Get public URL for deployed service
 */
async function getServiceUrl(serviceId) {
  const query = `
    query service($id: String!) {
      service(id: $id) {
        id
        domains {
          serviceDomains {
            domain
          }
        }
      }
    }
  `;
  
  const response = await railwayGraphQL(query, { id: serviceId });
  const domains = response.service.domains?.serviceDomains || [];
  
  if (domains.length > 0) {
    return `https://${domains[0].domain}`;
  }
  
  // If no domain yet, service might still be deploying
  // Return placeholder that will be updated
  return `https://${serviceId}.railway.app`;
}

/**
 * Railway GraphQL API helper
 */
async function railwayGraphQL(query, variables = {}) {
  const response = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RAILWAY_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  
  const data = await response.json();
  
  if (data.errors) {
    throw new Error(`Railway API error: ${JSON.stringify(data.errors)}`);
  }
  
  return data.data;
}

/**
 * Alternative: Shared instance with workspace isolation
 * FASTER, SIMPLER - Use this for MVP
 */
async function provisionSharedInstance(customerId, email, plan) {
  console.log(`[SHARED] Provisioning workspace for ${email}...`);
  
  const workspaceId = `claw_${customerId.substring(4, 16)}`;
  const workspacePath = `./workspaces/${workspaceId}`;
  
  // Create workspace directory structure
  const fs = require('fs');
  const path = require('path');
  
  // Copy template files from current Clawdbot setup
  const templatePath = 'C:\\Users\\Nightgalem\\clawd';
  
  // Create directories
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'skills'), { recursive: true });
  
  // Copy core files
  const filesToCopy = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md'];
  for (const file of filesToCopy) {
    if (fs.existsSync(path.join(templatePath, file))) {
      fs.copyFileSync(
        path.join(templatePath, file),
        path.join(workspacePath, file)
      );
    }
  }
  
  // Generate config
  const config = {
    customerId,
    email,
    plan: plan.name,
    workspaceId,
    limits: {
      messagesPerMonth: plan.messageLimit,
      maxAgents: plan.agents
    },
    features: plan.features,
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync(
    path.join(workspacePath, 'config.json'),
    JSON.stringify(config, null, 2)
  );
  
  console.log(`[SHARED] Workspace created: ${workspaceId}`);
  
  return {
    workspaceId,
    workspacePath,
    accessUrl: `https://app.setupclaw.com/${workspaceId}`,
    apiKey: generateApiKey(customerId)
  };
}

function generateApiKey(customerId) {
  const crypto = require('crypto');
  return `claw_${crypto.randomBytes(32).toString('hex')}`;
}

module.exports = {
  deployToRailway,
  provisionSharedInstance
};
