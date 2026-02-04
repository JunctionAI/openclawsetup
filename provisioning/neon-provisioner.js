/**
 * Neon Database Provisioner
 * Creates isolated PostgreSQL databases for each customer
 */

const axios = require('axios');

const NEON_API = 'https://console.neon.tech/api/v2';
const NEON_API_KEY = process.env.NEON_API_KEY;
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID;

class NeonProvisioner {
  constructor() {
    if (!NEON_API_KEY) {
      throw new Error('NEON_API_KEY environment variable required');
    }
    this.headers = {
      'Authorization': `Bearer ${NEON_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Create isolated branch/database for customer
   */
  async createDatabase(workspaceId) {
    console.log(`[NEON] Creating database for ${workspaceId}`);

    // Create a new branch (isolated copy of the database)
    const branch = await this.createBranch(workspaceId);
    console.log(`[NEON] Branch created: ${branch.id}`);

    // Get connection string
    const connectionString = await this.getConnectionString(branch.id);
    console.log(`[NEON] Connection string generated`);

    // Initialize schema
    await this.initializeSchema(connectionString, workspaceId);
    console.log(`[NEON] Schema initialized`);

    return {
      branchId: branch.id,
      connectionString,
      databaseName: workspaceId.replace(/[^a-z0-9_]/gi, '_')
    };
  }

  /**
   * Create Neon branch (isolated database copy)
   */
  async createBranch(workspaceId) {
    try {
      const response = await axios.post(
        `${NEON_API}/projects/${NEON_PROJECT_ID}/branches`,
        {
          name: workspaceId,
          parent_id: await this.getMainBranchId()
        },
        { headers: this.headers }
      );

      return response.data.branch;
    } catch (error) {
      console.error('Failed to create Neon branch:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get main branch ID (template to fork from)
   */
  async getMainBranchId() {
    try {
      const response = await axios.get(
        `${NEON_API}/projects/${NEON_PROJECT_ID}/branches`,
        { headers: this.headers }
      );

      const mainBranch = response.data.branches.find(b => b.name === 'main');
      return mainBranch?.id || response.data.branches[0].id;
    } catch (error) {
      console.error('Failed to get main branch:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get connection string for branch
   */
  async getConnectionString(branchId) {
    try {
      const response = await axios.get(
        `${NEON_API}/projects/${NEON_PROJECT_ID}/branches/${branchId}/connection_uri`,
        { headers: this.headers }
      );

      return response.data.uri;
    } catch (error) {
      console.error('Failed to get connection string:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Initialize database schema for customer
   */
  async initializeSchema(connectionString, workspaceId) {
    const { Client } = require('pg');
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });

    try {
      await client.connect();

      // BUG-009 fix: Create pgvector extension if not exists
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
        console.log(`[NEON] pgvector extension enabled for ${workspaceId}`);
      } catch (extError) {
        console.warn(`[NEON] Could not enable pgvector (may not be available): ${extError.message}`);
        // Continue without vector support - will use text search instead
      }

      // Create tables for agent memory, skills, etc.
      // Note: vector column may fail if extension not available
      await client.query(`
        CREATE TABLE IF NOT EXISTS memories (
          id SERIAL PRIMARY KEY,
          agent_id VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        -- Try to add vector column separately (may fail if extension not available)
        DO $$ 
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
            ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(1536);
          END IF;
        EXCEPTION WHEN OTHERS THEN
          NULL; -- Ignore if vector type doesn't exist
        END $$;

        CREATE TABLE IF NOT EXISTS conversations (
          id SERIAL PRIMARY KEY,
          agent_id VARCHAR(255) NOT NULL,
          channel VARCHAR(100),
          message TEXT NOT NULL,
          role VARCHAR(50),
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS skills (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          enabled BOOLEAN DEFAULT true,
          config JSONB,
          installed_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS usage_tracking (
          id SERIAL PRIMARY KEY,
          date DATE NOT NULL,
          messages_sent INT DEFAULT 0,
          api_calls INT DEFAULT 0,
          tokens_used BIGINT DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE INDEX idx_memories_agent ON memories(agent_id);
        CREATE INDEX idx_conversations_agent ON conversations(agent_id);
        CREATE INDEX idx_usage_date ON usage_tracking(date);
      `);

      console.log(`[NEON] Schema initialized for ${workspaceId}`);
    } finally {
      await client.end();
    }
  }

  /**
   * Delete customer database (on cancellation)
   */
  async deleteDatabase(branchId) {
    console.log(`[NEON] Deleting branch ${branchId}`);

    try {
      await axios.delete(
        `${NEON_API}/projects/${NEON_PROJECT_ID}/branches/${branchId}`,
        { headers: this.headers }
      );

      console.log(`[NEON] Branch deleted: ${branchId}`);
    } catch (error) {
      console.error('Failed to delete Neon branch:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get database usage metrics
   */
  async getDatabaseUsage(branchId) {
    try {
      const response = await axios.get(
        `${NEON_API}/projects/${NEON_PROJECT_ID}/branches/${branchId}/metrics`,
        { headers: this.headers }
      );

      return response.data;
    } catch (error) {
      console.error('Failed to get database metrics:', error.response?.data || error.message);
      return null;
    }
  }
}

module.exports = { NeonProvisioner };
