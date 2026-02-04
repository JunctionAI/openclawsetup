# Testing Guide - Clawdbot Backend

This document describes the test suite for the Clawdbot SaaS backend.

## Overview

The test suite is organized into three categories:
- **Unit Tests**: Test individual functions in isolation
- **Integration Tests**: Test API endpoints with mocked dependencies
- **E2E Tests**: (Located in dashboard) Test complete user flows

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage report
npm test -- --coverage

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Watch mode for development
npm run test:watch
```

## Test Structure

```
__tests__/
├── setup.js           # Global test configuration and utilities
├── unit/
│   ├── security.test.js     # Security utilities
│   ├── plans.test.js        # Plan configuration
│   ├── email.test.js        # Email module
│   └── chat-handler.test.js # AI chat handler
└── integration/
    ├── workspace-api.test.js # Workspace REST API
    └── webhook.test.js       # Stripe webhook handler
```

## Test Categories

### Unit Tests

#### security.test.js
Tests the security module (`lib/security.js`):
- **API Key Generation**: Entropy, uniqueness, format
- **Hashing**: SHA-256 consistency, collision resistance
- **Timing-Safe Comparison**: Constant-time string comparison
- **Input Sanitization**: SQL LIKE escaping, log redaction
- **Validation**: Email format, disposable domains, workspace IDs, price IDs
- **Rate Limiting**: Request counting, window expiration, IP tracking

#### plans.test.js
Tests the plans module (`plans.js`):
- **Plan Configuration**: Message limits, agent counts, features
- **Plan Lookup**: By price ID, by name
- **Feature Access**: Feature availability per plan
- **Upgrade Paths**: Logical progression between tiers
- **Price ID Validation**: Whitelist enforcement

#### email.test.js
Tests the email module (`email.js`):
- **Welcome Email**: Credential inclusion, API key masking
- **Payment Failed Email**: Severity escalation, retry messaging
- **Cancellation Email**: Retention policy, resubscribe option
- **Error Handling**: Graceful failure on API errors

#### chat-handler.test.js
Tests the AI chat handler (`api/chat-handler.js`):
- **Context Loading**: USER.md, SOUL.md, MEMORY.md parsing
- **System Prompt Building**: Plan limits, memory inclusion
- **AI Integration**: Claude primary, OpenAI fallback
- **Memory Persistence**: Daily file creation, conversation logging

### Integration Tests

#### workspace-api.test.js
Tests workspace REST endpoints (`api/workspace.js`):
- **GET /api/workspace/:id**: Public workspace info
- **GET /api/workspace/:id/status**: Authenticated usage stats
- **POST /api/workspace/:id/chat**: Message sending, rate limits
- **GET /api/workspace/:id/conversations**: History retrieval
- **POST /api/workspace/:id/memory**: Memory storage
- **GET /api/workspace/:id/memory/search**: Search with LIKE escaping
- **Security**: Auth header validation, cross-workspace access prevention

#### webhook.test.js
Tests Stripe webhook handler:
- **Signature Verification**: Valid/invalid signatures
- **Event Handling**: checkout.session.completed, subscription changes
- **Idempotency**: Duplicate webhook prevention
- **Error Handling**: Database errors, malformed payloads

## Bug-Catching Tests

Each test file includes specific tests designed to catch common bugs:

### SQL Injection Prevention
```javascript
it('should escape LIKE special characters', () => {
  const escaped = escapeLikePattern('%admin%');
  expect(escaped).toBe('\\%admin\\%');
});
```

### Rate Limit Bypass
```javascript
it('should enforce message limits', async () => {
  // Mock user at limit
  const response = await request(app)
    .post('/api/workspace/test/chat')
    .send({ message: 'Hello' })
    .expect(429);
});
```

### Authentication Bypass
```javascript
it('should reject malformed authorization headers', async () => {
  const res = await request(app)
    .get('/api/workspace/test/status')
    .set('Authorization', 'NotBearer token')
    .expect(401);
});
```

### Webhook Replay Attacks
```javascript
it('should not provision twice for same checkout session', async () => {
  // First webhook - should provision
  // Second webhook - should be idempotent
});
```

## Coverage Requirements

The test suite enforces minimum coverage thresholds:

```javascript
coverageThreshold: {
  global: {
    branches: 70,
    functions: 70,
    lines: 70,
    statements: 70,
  },
},
```

## Test Utilities

The setup file provides global utilities:

```javascript
global.testUtils = {
  createStripeEvent: (type, data) => {...},
  createCustomerId: () => `cus_...`,
  createWorkspaceId: () => `claw_xxxx_xxxxxxxx`,
  createApiKey: () => `claw_...`,
  wait: (ms) => new Promise(...),
};
```

## Mocking Strategy

### Database (pg)
```javascript
jest.mock('pg', () => {
  const mockPool = { query: jest.fn() };
  return { Pool: jest.fn(() => mockPool), __mockPool: mockPool };
});
```

### Stripe
```javascript
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  webhooks: { constructEvent: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
})));
```

### Email (Resend)
```javascript
global.fetch = jest.fn().mockResolvedValue({ ok: true });
```

## Adding New Tests

1. **Unit Test**: Create file in `__tests__/unit/[module].test.js`
2. **Integration Test**: Create file in `__tests__/integration/[endpoint].test.js`
3. **Always test**: Happy path, error cases, edge cases, security
4. **Use descriptive names**: `it('should reject invalid API key', ...)`
5. **Add bug catchers**: Tests that specifically catch known bug patterns

## CI/CD Integration

Tests are designed to run in CI pipelines:
- No external dependencies (all mocked)
- Deterministic (no flaky tests)
- Fast execution (< 30 seconds total)
- Coverage reports generated automatically
