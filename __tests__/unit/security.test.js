/**
 * Unit Tests for Security Module
 * Tests crypto functions, validation, and sanitization
 */

const {
  generateApiKey,
  hashApiKey,
  timingSafeEqual,
  escapeLikePattern,
  sanitizeForLogging,
  validateEmail,
  validateWorkspaceId,
  validatePriceId,
  createRateLimiter,
} = require('../../lib/security');

describe('Security Module', () => {
  describe('generateApiKey', () => {
    it('should generate a key with correct format', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^claw_[a-f0-9]{64}$/);
    });

    it('should generate unique keys', () => {
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }
      expect(keys.size).toBe(100);
    });

    it('should generate keys with sufficient entropy', () => {
      // 32 bytes = 256 bits of entropy, represented as 64 hex chars
      const key = generateApiKey();
      const hexPart = key.replace('claw_', '');
      expect(hexPart.length).toBe(64);
    });
  });

  describe('hashApiKey', () => {
    it('should return consistent hash for same input', () => {
      const key = 'claw_test123';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different inputs', () => {
      const hash1 = hashApiKey('key1');
      const hash2 = hashApiKey('key2');
      expect(hash1).not.toBe(hash2);
    });

    it('should return a 64-character hex string (SHA-256)', () => {
      const hash = hashApiKey('test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('timingSafeEqual', () => {
    it('should return true for equal strings', () => {
      expect(timingSafeEqual('abc', 'abc')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(timingSafeEqual('abc', 'abd')).toBe(false);
    });

    it('should return false for different length strings', () => {
      expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    });

    it('should return false for non-string inputs', () => {
      expect(timingSafeEqual(123, 123)).toBe(false);
      expect(timingSafeEqual(null, null)).toBe(false);
      expect(timingSafeEqual(undefined, undefined)).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(timingSafeEqual('', '')).toBe(true);
      expect(timingSafeEqual('', 'a')).toBe(false);
    });
  });

  describe('escapeLikePattern', () => {
    it('should escape percent signs', () => {
      expect(escapeLikePattern('100%')).toBe('100\\%');
    });

    it('should escape underscores', () => {
      expect(escapeLikePattern('test_user')).toBe('test\\_user');
    });

    it('should escape backslashes', () => {
      expect(escapeLikePattern('path\\file')).toBe('path\\\\file');
    });

    it('should escape all special characters together', () => {
      expect(escapeLikePattern('50% test_user\\path')).toBe(
        '50\\% test\\_user\\\\path'
      );
    });

    it('should return empty string for non-string input', () => {
      expect(escapeLikePattern(null)).toBe('');
      expect(escapeLikePattern(undefined)).toBe('');
      expect(escapeLikePattern(123)).toBe('');
    });

    it('should handle empty string', () => {
      expect(escapeLikePattern('')).toBe('');
    });

    // BUG CATCHER: SQL injection via LIKE pattern
    it('should prevent LIKE injection attacks', () => {
      const malicious = '%admin%';
      const escaped = escapeLikePattern(malicious);
      expect(escaped).toBe('\\%admin\\%');
      // In SQL: WHERE name LIKE '%\%admin\%%' won't match everything
    });
  });

  describe('sanitizeForLogging', () => {
    it('should redact API keys', () => {
      const input = 'API key: claw_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const output = sanitizeForLogging(input);
      expect(output).toBe('API key: claw_[REDACTED]');
    });

    it('should redact Stripe live keys', () => {
      const input = 'Key: sk_live_abc123XYZ';
      const output = sanitizeForLogging(input);
      expect(output).toBe('Key: sk_live_[REDACTED]');
    });

    it('should redact Stripe test keys', () => {
      const input = 'Key: sk_test_abc123XYZ';
      const output = sanitizeForLogging(input);
      expect(output).toBe('Key: sk_test_[REDACTED]');
    });

    it('should partially redact email addresses', () => {
      const input = 'Email: john.doe@example.com';
      const output = sanitizeForLogging(input);
      expect(output).toContain('jo***@[REDACTED]');
    });

    it('should redact Bearer tokens', () => {
      const input = 'Header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const output = sanitizeForLogging(input);
      expect(output).toBe('Header: Bearer [REDACTED]');
    });

    it('should handle non-string input', () => {
      expect(sanitizeForLogging(123)).toBe('123');
      expect(sanitizeForLogging({ a: 1 })).toBe('[object Object]');
    });
  });

  describe('validateEmail', () => {
    it('should accept valid email addresses', () => {
      const validEmails = [
        'user@example.com',
        'user.name@example.co.nz',
        'user+tag@example.com',
        'u@ex.co',
      ];

      validEmails.forEach((email) => {
        const result = validateEmail(email);
        expect(result.valid).toBe(true);
        expect(result.email).toBe(email.toLowerCase());
      });
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'not-an-email',
        '@missing-local.com',
        'missing-at-sign',
        'missing@.com',
        '',
      ];

      invalidEmails.forEach((email) => {
        const result = validateEmail(email);
        expect(result.valid).toBe(false);
      });
    });

    it('should reject disposable email domains', () => {
      const disposable = [
        'test@mailinator.com',
        'test@tempmail.com',
        'test@guerrillamail.com',
        'test@10minutemail.com',
        'test@yopmail.com',
      ];

      disposable.forEach((email) => {
        const result = validateEmail(email);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Disposable');
      });
    });

    it('should reject very long email addresses', () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      const result = validateEmail(longEmail);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should trim and lowercase valid emails', () => {
      const result = validateEmail('  TEST@EXAMPLE.COM  ');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('test@example.com');
    });

    it('should handle null/undefined input', () => {
      expect(validateEmail(null).valid).toBe(false);
      expect(validateEmail(undefined).valid).toBe(false);
    });
  });

  describe('validateWorkspaceId', () => {
    it('should accept valid workspace IDs', () => {
      const validIds = [
        'claw_abcd_12345678',
        'claw_test_abcdef01',
        'claw_wxyz_00000000',
      ];

      validIds.forEach((id) => {
        const result = validateWorkspaceId(id);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid workspace ID formats', () => {
      const invalidIds = [
        'invalid',
        'claw_',
        'claw_abc_123', // too short
        'claw_ABCD_12345678', // uppercase letters
        'claw_abcd_1234567g', // invalid hex
        'clay_abcd_12345678', // wrong prefix
        '',
        null,
        undefined,
      ];

      invalidIds.forEach((id) => {
        const result = validateWorkspaceId(id);
        expect(result.valid).toBe(false);
      });
    });

    // BUG CATCHER: Path traversal via workspace ID
    it('should prevent path traversal attacks', () => {
      const malicious = ['claw_../._12345678', 'claw_ab%2F_12345678'];
      malicious.forEach((id) => {
        const result = validateWorkspaceId(id);
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('validatePriceId', () => {
    const allowedPrices = new Set([
      'price_1SwtCbBfSldKMuDjM3p0kyG4',
      'price_1SwtCbBfSldKMuDjDmRHqErh',
      'price_1SwtCcBfSldKMuDjEKBqQ6lH',
    ]);

    it('should accept valid, whitelisted price IDs', () => {
      const result = validatePriceId(
        'price_1SwtCbBfSldKMuDjM3p0kyG4',
        allowedPrices
      );
      expect(result.valid).toBe(true);
    });

    it('should reject non-whitelisted price IDs', () => {
      const result = validatePriceId('price_fake_not_allowed', allowedPrices);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid price ID');
    });

    it('should reject invalid format', () => {
      const result = validatePriceId('not_a_price', allowedPrices);
      expect(result.valid).toBe(false);
    });

    it('should reject very long price IDs', () => {
      const longPriceId = 'price_' + 'a'.repeat(200);
      const result = validatePriceId(longPriceId, allowedPrices);
      expect(result.valid).toBe(false);
    });

    it('should handle null/undefined', () => {
      expect(validatePriceId(null, allowedPrices).valid).toBe(false);
      expect(validatePriceId(undefined, allowedPrices).valid).toBe(false);
    });
  });

  describe('createRateLimiter', () => {
    it('should allow requests within limit', async () => {
      const limiter = createRateLimiter({ maxRequests: 5, windowMs: 1000 });
      const req = { ip: '127.0.0.1' };

      for (let i = 0; i < 5; i++) {
        const result = await limiter.check(req);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }
    });

    it('should block requests over limit', async () => {
      const limiter = createRateLimiter({ maxRequests: 3, windowMs: 1000 });
      const req = { ip: '127.0.0.1' };

      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await limiter.check(req);
      }

      // This one should be blocked
      const result = await limiter.check(req);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset after window expires', async () => {
      const limiter = createRateLimiter({ maxRequests: 2, windowMs: 50 });
      const req = { ip: '127.0.0.1' };

      // Exhaust limit
      await limiter.check(req);
      await limiter.check(req);
      expect((await limiter.check(req)).allowed).toBe(false);

      // Wait for reset
      await global.testUtils.wait(60);

      // Should be allowed again
      const result = await limiter.check(req);
      expect(result.allowed).toBe(true);
    });

    it('should track different IPs separately', async () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1000 });

      const result1 = await limiter.check({ ip: '1.1.1.1' });
      const result2 = await limiter.check({ ip: '2.2.2.2' });

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);

      // Both should be blocked on second request
      expect((await limiter.check({ ip: '1.1.1.1' })).allowed).toBe(false);
      expect((await limiter.check({ ip: '2.2.2.2' })).allowed).toBe(false);
    });
  });
});
