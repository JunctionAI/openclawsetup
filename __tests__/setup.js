/**
 * Jest Test Setup
 * Configures test environment and mocks
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock_secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.RESEND_API_KEY = 'test_resend_key';
process.env.ANTHROPIC_API_KEY = 'test_anthropic_key';

// Global test utilities
global.testUtils = {
  // Generate a mock Stripe event
  createStripeEvent: (type, data) => ({
    id: `evt_${Date.now()}`,
    type,
    data: { object: data },
    created: Math.floor(Date.now() / 1000),
  }),

  // Generate a mock customer ID
  createCustomerId: () => `cus_${Math.random().toString(36).substring(2, 15)}`,

  // Generate a mock workspace ID
  createWorkspaceId: () => `claw_${randomLetters(4)}_${randomHex(8)}`,

  // Generate a mock API key
  createApiKey: () => `claw_${randomHex(32)}`,

  // Wait helper
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function randomLetters(length) {
  return Array(length)
    .fill(0)
    .map(() => String.fromCharCode(97 + Math.floor(Math.random() * 26)))
    .join('');
}

function randomHex(length) {
  return Array(length)
    .fill(0)
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
}

// Suppress console.log during tests (uncomment if noisy)
// jest.spyOn(console, 'log').mockImplementation(() => {});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
