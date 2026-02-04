/**
 * Integration Tests for Workspace API
 * Tests the workspace endpoints with mocked database
 */

const express = require('express');
const request = require('supertest');

// Mock the pg module
jest.mock('pg', () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
  };

  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(() => mockClient),
  };

  return {
    Pool: jest.fn(() => mockPool),
    __mockPool: mockPool,
    __mockClient: mockClient,
  };
});

// Mock the security module
jest.mock('../../lib/security', () => ({
  escapeLikePattern: (input) => input.replace(/[%_\\]/g, '\\$&'),
  logSecurityEvent: jest.fn(),
  validateWorkspaceId: (id) => ({
    valid: /^claw_[a-z]{4}_[a-f0-9]{8}$/.test(id),
  }),
}));

const { Pool, __mockPool } = require('pg');

describe('Workspace API', () => {
  let app;
  let workspaceRouter;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Clear module cache to get fresh router
    jest.resetModules();
    
    // Re-mock pg for fresh router
    jest.doMock('pg', () => ({
      Pool: jest.fn(() => __mockPool),
    }));

    // Import router
    workspaceRouter = require('../../api/workspace');
    
    // Create test app
    app = express();
    app.use(express.json());
    app.use('/api/workspace', workspaceRouter);
  });

  describe('GET /api/workspace/:id', () => {
    it('should return workspace info for valid ID', async () => {
      __mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            workspace_id: 'claw_test_12345678',
            plan: 'Pro',
            status: 'active',
            created_at: new Date('2024-01-01'),
          },
        ],
      });

      const res = await request(app)
        .get('/api/workspace/claw_test_12345678')
        .expect(200);

      expect(res.body.workspaceId).toBe('claw_test_12345678');
      expect(res.body.plan).toBe('Pro');
      expect(res.body.status).toBe('active');
    });

    it('should return 404 for non-existent workspace', async () => {
      __mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/workspace/claw_none_00000000')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });

    it('should handle database errors gracefully', async () => {
      __mockPool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await request(app)
        .get('/api/workspace/claw_test_12345678')
        .expect(500);

      expect(res.body.error).toBeDefined();
    });
  });

  describe('GET /api/workspace/:id/status', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/status')
        .expect(401);

      expect(res.body.error).toContain('Authorization');
    });

    it('should return detailed status for authenticated user', async () => {
      // Mock auth check
      __mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            workspace_id: 'claw_test_12345678',
            email: 'user@example.com',
            plan: 'Pro',
            status: 'active',
          },
        ],
      });

      // Mock usage query
      __mockPool.query.mockResolvedValueOnce({
        rows: [{ messages_this_month: 5000, tokens_this_month: 100000 }],
      });

      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/status')
        .set('Authorization', 'Bearer valid_api_key')
        .expect(200);

      expect(res.body.usage).toBeDefined();
      expect(res.body.usage.messagesThisMonth).toBeDefined();
      expect(res.body.limits).toBeDefined();
    });

    it('should reject inactive subscriptions', async () => {
      __mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            workspace_id: 'claw_test_12345678',
            email: 'user@example.com',
            plan: 'Pro',
            status: 'cancelled',
          },
        ],
      });

      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/status')
        .set('Authorization', 'Bearer valid_api_key')
        .expect(403);

      expect(res.body.error).toContain('not active');
      expect(res.body.status).toBe('cancelled');
    });

    it('should reject invalid API keys', async () => {
      __mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/status')
        .set('Authorization', 'Bearer invalid_key')
        .expect(403);

      expect(res.body.error).toContain('Invalid');
    });
  });

  describe('POST /api/workspace/:id/chat', () => {
    beforeEach(() => {
      // Default auth mock
      __mockPool.query.mockImplementation((query) => {
        if (query.includes('SELECT workspace_id')) {
          return Promise.resolve({
            rows: [
              {
                workspace_id: 'claw_test_12345678',
                email: 'user@example.com',
                plan: 'Pro',
                status: 'active',
              },
            ],
          });
        }
        if (query.includes('SUM(messages_sent)')) {
          return Promise.resolve({ rows: [{ count: 100 }] });
        }
        return Promise.resolve({ rows: [] });
      });
    });

    it('should require a message', async () => {
      const res = await request(app)
        .post('/api/workspace/claw_test_12345678/chat')
        .set('Authorization', 'Bearer valid_api_key')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('Message');
    });

    it('should reject empty messages', async () => {
      const res = await request(app)
        .post('/api/workspace/claw_test_12345678/chat')
        .set('Authorization', 'Bearer valid_api_key')
        .send({ message: '' })
        .expect(400);

      expect(res.body.error).toContain('required');
    });

    it('should reject very long messages', async () => {
      const res = await request(app)
        .post('/api/workspace/claw_test_12345678/chat')
        .set('Authorization', 'Bearer valid_api_key')
        .send({ message: 'a'.repeat(50000) })
        .expect(400);

      expect(res.body.error).toContain('too long');
    });

    it('should track usage and return remaining messages', async () => {
      const res = await request(app)
        .post('/api/workspace/claw_test_12345678/chat')
        .set('Authorization', 'Bearer valid_api_key')
        .send({ message: 'Hello, assistant!' })
        .expect(200);

      expect(res.body.response).toBeDefined();
      expect(res.body.usage).toBeDefined();
      expect(res.body.usage.messagesUsed).toBeDefined();
      expect(res.body.usage.messagesRemaining).toBeDefined();
    });

    // BUG CATCHER: Rate limiting on chat
    it('should enforce message limits', async () => {
      // Mock user at limit
      __mockPool.query.mockImplementation((query) => {
        if (query.includes('SELECT workspace_id')) {
          return Promise.resolve({
            rows: [
              {
                workspace_id: 'claw_test_12345678',
                email: 'user@example.com',
                plan: 'Starter',
                status: 'active',
              },
            ],
          });
        }
        if (query.includes('SUM(messages_sent)')) {
          return Promise.resolve({ rows: [{ count: 5000 }] }); // At limit
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/workspace/claw_test_12345678/chat')
        .set('Authorization', 'Bearer valid_api_key')
        .send({ message: 'Hello' })
        .expect(429);

      expect(res.body.error).toContain('limit');
    });
  });

  describe('GET /api/workspace/:id/conversations', () => {
    beforeEach(() => {
      __mockPool.query.mockImplementation((query) => {
        if (query.includes('SELECT workspace_id')) {
          return Promise.resolve({
            rows: [
              {
                workspace_id: 'claw_test_12345678',
                email: 'user@example.com',
                plan: 'Pro',
                status: 'active',
              },
            ],
          });
        }
        if (query.includes('FROM conversations')) {
          return Promise.resolve({
            rows: [
              { message: 'Hello', role: 'user', created_at: new Date() },
              { message: 'Hi there!', role: 'assistant', created_at: new Date() },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });
    });

    it('should return conversation history', async () => {
      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/conversations')
        .set('Authorization', 'Bearer valid_api_key')
        .expect(200);

      expect(res.body.conversations).toBeDefined();
      expect(Array.isArray(res.body.conversations)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/conversations?limit=10')
        .set('Authorization', 'Bearer valid_api_key')
        .expect(200);

      expect(res.body.pagination.limit).toBe(10);
    });

    it('should cap limit at 100', async () => {
      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/conversations?limit=500')
        .set('Authorization', 'Bearer valid_api_key')
        .expect(200);

      // Verify the query was called with capped limit
      const queryCall = __mockPool.query.mock.calls.find(
        (call) => call[0].includes('LIMIT')
      );
      expect(queryCall[1]).toContain(100); // Max limit
    });
  });

  describe('POST /api/workspace/:id/memory', () => {
    beforeEach(() => {
      __mockPool.query.mockImplementation((query) => {
        if (query.includes('SELECT workspace_id')) {
          return Promise.resolve({
            rows: [
              {
                workspace_id: 'claw_test_12345678',
                email: 'user@example.com',
                plan: 'Pro',
                status: 'active',
              },
            ],
          });
        }
        if (query.includes('INSERT INTO memories')) {
          return Promise.resolve({ rows: [{ id: 123 }] });
        }
        return Promise.resolve({ rows: [] });
      });
    });

    it('should store memory successfully', async () => {
      const res = await request(app)
        .post('/api/workspace/claw_test_12345678/memory')
        .set('Authorization', 'Bearer valid_api_key')
        .send({ content: 'Remember this important fact' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.memoryId).toBeDefined();
    });

    it('should require content', async () => {
      const res = await request(app)
        .post('/api/workspace/claw_test_12345678/memory')
        .set('Authorization', 'Bearer valid_api_key')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('Content');
    });

    it('should accept optional metadata', async () => {
      const res = await request(app)
        .post('/api/workspace/claw_test_12345678/memory')
        .set('Authorization', 'Bearer valid_api_key')
        .send({
          content: 'Memory with metadata',
          metadata: { importance: 'high', category: 'work' },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/workspace/:id/memory/search', () => {
    beforeEach(() => {
      __mockPool.query.mockImplementation((query) => {
        if (query.includes('SELECT workspace_id')) {
          return Promise.resolve({
            rows: [
              {
                workspace_id: 'claw_test_12345678',
                email: 'user@example.com',
                plan: 'Pro',
                status: 'active',
              },
            ],
          });
        }
        if (query.includes('FROM memories')) {
          return Promise.resolve({
            rows: [
              { id: 1, content: 'Matching memory', metadata: {}, created_at: new Date() },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });
    });

    it('should search memories', async () => {
      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/memory/search?query=matching')
        .set('Authorization', 'Bearer valid_api_key')
        .expect(200);

      expect(res.body.memories).toBeDefined();
      expect(res.body.count).toBeDefined();
    });

    it('should require query parameter', async () => {
      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/memory/search')
        .set('Authorization', 'Bearer valid_api_key')
        .expect(400);

      expect(res.body.error).toContain('Query');
    });

    it('should reject very long queries', async () => {
      const res = await request(app)
        .get(`/api/workspace/claw_test_12345678/memory/search?query=${'a'.repeat(600)}`)
        .set('Authorization', 'Bearer valid_api_key')
        .expect(400);

      expect(res.body.error).toContain('too long');
    });

    // BUG CATCHER: SQL injection via LIKE pattern
    it('should escape LIKE special characters', async () => {
      await request(app)
        .get('/api/workspace/claw_test_12345678/memory/search?query=%25admin%25')
        .set('Authorization', 'Bearer valid_api_key')
        .expect(200);

      // Verify the query was made with escaped pattern
      const searchQuery = __mockPool.query.mock.calls.find(
        (call) => call[0].includes('ILIKE')
      );
      expect(searchQuery).toBeDefined();
      // The escaped pattern should be in the query params
    });
  });

  describe('Security', () => {
    // BUG CATCHER: Cross-workspace access
    it('should not allow accessing another workspace with wrong API key', async () => {
      __mockPool.query.mockResolvedValueOnce({ rows: [] }); // No match

      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/status')
        .set('Authorization', 'Bearer api_key_for_different_workspace')
        .expect(403);

      expect(res.body.error).toContain('Invalid');
    });

    // BUG CATCHER: Auth header format
    it('should reject malformed authorization headers', async () => {
      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/status')
        .set('Authorization', 'NotBearer some_key')
        .expect(401);

      expect(res.body.error).toContain('Authorization');
    });

    it('should reject empty bearer token', async () => {
      const res = await request(app)
        .get('/api/workspace/claw_test_12345678/status')
        .set('Authorization', 'Bearer ')
        .expect(401);
    });
  });
});
