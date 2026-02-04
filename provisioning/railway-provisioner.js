/**
 * REAL Railway Provisioner
 * Creates actual Railway services for each customer
 */

const axios = require('axios');

// Railway GraphQL API
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';
const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN;

// Project/Environment setup
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID;
const RAILWAY_TEMPLATE_ID = process.env.RAILWAY_TEMPLATE_ID; // Pre-configured Clawdbot template

class RailwayProvisioner {
  constructor() {
    if (!RAILWAY_TOKEN) {
      throw new Error('RAILWAY_TOKEN environment variable required');
    }
    this.headers = {
      'Authorization': `Bearer ${RAILWAY_TOKEN}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * GraphQL query helper
   */
  async query(query, variables = {}) {
    try {
      const response = await axios.post(
        RAILWAY_API,
        { query, variables },
        { headers: this.headers }
      );

      if (response.data.errors) {
        throw new Error(`Railway API error: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data.data;
    } catch (error) {
      console.error('Railway API call failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Deploy new service from template for customer
   */
  async deployCustomerInstance(customerId, email, planConfig) {
    console.log(`[RAILWAY] Deploying instance for ${email}`);

    // Create unique service name
    const serviceName = `clawdbot-${customerId.substring(4, 16)}`;
    const workspaceId = `ws_${customerId.substring(4, 16)}_${Date.now()}`;

    // Create new service from template
    const service = await this.createService(serviceName);
    console.log(`[RAILWAY] Service created: ${service.id}`);

    // Configure environment variables
    await this.configureEnvironment(service.id, {
      CUSTOMER_ID: customerId,
      CUSTOMER_EMAIL: email,
      WORKSPACE_ID: workspaceId,
      PLAN_NAME: planConfig.name,
      MESSAGE_LIMIT: planConfig.messageLimit.toString(),
      MAX_AGENTS: planConfig.agents.toString(),
      FEATURES: planConfig.features.join(','),
      // Clawdbot configuration
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      DATABASE_URL: await this.createCustomerDatabase(workspaceId),
      // Memory configuration
      SUPERMEMORY_ENABLED: 'true',
      // Skills
      SKILLS_ENABLED: planConfig.features.join(',')
    });

    console.log(`[RAILWAY] Environment configured`);

    // Deploy the service
    const deployment = await this.triggerDeployment(service.id);
    console.log(`[RAILWAY] Deployment triggered: ${deployment.id}`);

    // Wait for deployment to complete
    const deployed = await this.waitForDeployment(deployment.id);
    console.log(`[RAILWAY] Deployment complete: ${deployed.status}`);

    // Get public URL
    const publicUrl = await this.getServiceUrl(service.id);
    console.log(`[RAILWAY] Public URL: ${publicUrl}`);

    return {
      instanceId: service.id,
      deploymentId: deployment.id,
      workspaceId,
      accessUrl: publicUrl,
      railwayServiceUrl: `https://railway.app/project/${RAILWAY_PROJECT_ID}/service/${service.id}`
    };
  }

  /**
   * Create a new Railway service
   */
  async createService(name) {
    const mutation = `
      mutation ServiceCreate($projectId: String!, $name: String!, $source: ServiceSourceInput) {
        serviceCreate(input: {
          projectId: $projectId
          name: $name
          source: $source
        }) {
          id
          name
        }
      }
    `;

    // Use GitHub repo as source
    const source = {
      repo: process.env.CLAWDBOT_REPO || 'JunctionAI/clawdbot-runtime',
      branch: 'main'
    };

    const result = await this.query(mutation, {
      projectId: RAILWAY_PROJECT_ID,
      name,
      source
    });

    return result.serviceCreate;
  }

  /**
   * Configure service environment variables
   */
  async configureEnvironment(serviceId, variables) {
    const mutation = `
      mutation VariableCollectionUpsert($serviceId: String!, $environmentId: String!, $variables: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: {
          serviceId: $serviceId
          environmentId: $environmentId
          variables: $variables
        })
      }
    `;

    // Get production environment ID
    const envId = await this.getProductionEnvironmentId();

    for (const [key, value] of Object.entries(variables)) {
      await this.query(mutation, {
        serviceId,
        environmentId: envId,
        variables: {
          [key]: value
        }
      });
    }
  }

  /**
   * Trigger deployment
   */
  async triggerDeployment(serviceId) {
    const mutation = `
      mutation DeploymentTrigger($serviceId: String!) {
        deploymentTrigger(input: {
          serviceId: $serviceId
        }) {
          id
          status
        }
      }
    `;

    const result = await this.query(mutation, { serviceId });
    return result.deploymentTrigger;
  }

  /**
   * Wait for deployment to complete
   */
  async waitForDeployment(deploymentId, maxWaitMs = 300000) {
    const query = `
      query Deployment($id: String!) {
        deployment(id: $id) {
          id
          status
          meta
        }
      }
    `;

    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.query(query, { id: deploymentId });
      const status = result.deployment.status;

      if (status === 'SUCCESS') {
        return result.deployment;
      } else if (status === 'FAILED' || status === 'CRASHED') {
        throw new Error(`Deployment failed: ${status}`);
      }

      // Wait 10 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    throw new Error('Deployment timeout');
  }

  /**
   * Get service public URL
   */
  async getServiceUrl(serviceId) {
    const mutation = `
      mutation ServiceDomainCreate($serviceId: String!, $environmentId: String!) {
        serviceDomainCreate(input: {
          serviceId: $serviceId
          environmentId: $environmentId
        }) {
          domain
        }
      }
    `;

    const envId = await this.getProductionEnvironmentId();
    const result = await this.query(mutation, {
      serviceId,
      environmentId: envId
    });

    return `https://${result.serviceDomainCreate.domain}`;
  }

  /**
   * Create isolated database for customer
   */
  async createCustomerDatabase(workspaceId) {
    // Use Neon for PostgreSQL databases
    const { NeonProvisioner } = require('./neon-provisioner');
    const neon = new NeonProvisioner();

    const db = await neon.createDatabase(workspaceId);
    return db.connectionString;
  }

  /**
   * Get production environment ID
   */
  async getProductionEnvironmentId() {
    const query = `
      query Project($id: String!) {
        project(id: $id) {
          environments {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `;

    const result = await this.query(query, { id: RAILWAY_PROJECT_ID });
    const prodEnv = result.project.environments.edges.find(
      e => e.node.name === 'production'
    );

    return prodEnv?.node.id || result.project.environments.edges[0]?.node.id;
  }

  /**
   * Deprovision customer service
   */
  async deprovisionCustomer(instanceId) {
    console.log(`[RAILWAY] Deprovisioning service ${instanceId}`);

    const mutation = `
      mutation ServiceDelete($id: String!) {
        serviceDelete(id: $id)
      }
    `;

    await this.query(mutation, { id: instanceId });
    console.log(`[RAILWAY] Service deleted: ${instanceId}`);
  }

  /**
   * Scale service based on plan
   */
  async scaleService(instanceId, planConfig) {
    // Railway auto-scales, but we can set resource limits
    const mutation = `
      mutation ServiceUpdate($id: String!, $input: ServiceUpdateInput!) {
        serviceUpdate(id: $id, input: $input) {
          id
        }
      }
    `;

    // Set resource limits based on plan
    const resources = this.getPlanResources(planConfig);

    await this.query(mutation, {
      id: instanceId,
      input: {
        ...resources
      }
    });
  }

  /**
   * Get resource allocation for plan
   */
  getPlanResources(planConfig) {
    const resourceMap = {
      'Starter': {
        cpu: '0.5',
        memory: '512MB'
      },
      'Pro': {
        cpu: '1',
        memory: '1GB'
      },
      'Team': {
        cpu: '2',
        memory: '2GB'
      }
    };

    return resourceMap[planConfig.name] || resourceMap['Starter'];
  }
}

module.exports = RailwayProvisioner;
