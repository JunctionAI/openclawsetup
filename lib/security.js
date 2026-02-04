/**
 * Security Utilities for Clawdbot SaaS
 * Implements fixes identified in security audit
 */

const crypto = require('crypto');

// ============================================
// API KEY HANDLING
// ============================================

/**
 * Generate a secure API key
 * Format: claw_[32 random bytes in hex]
 */
function generateApiKey() {
  const randomBytes = crypto.randomBytes(32);
  return `claw_${randomBytes.toString('hex')}`;
}

/**
 * Hash an API key for storage
 * Uses SHA-256 (fast enough for API keys, bcrypt would be overkill)
 * 
 * NOTE: We use SHA-256 because:
 * 1. API keys are high-entropy (not passwords)
 * 2. We need fast comparison for every API call
 * 3. Timing attacks are mitigated by the database lookup
 * 
 * @param {string} apiKey - The plaintext API key
 * @returns {string} SHA-256 hash of the key
 */
function hashApiKey(apiKey) {
  return crypto
    .createHash('sha256')
    .update(apiKey)
    .digest('hex');
}

/**
 * Timing-safe comparison of two strings
 * Prevents timing attacks when comparing secrets
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if equal
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  
  // Ensure both strings have the same length to prevent length oracle
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  
  if (bufferA.length !== bufferB.length) {
    // Still perform comparison to maintain constant time
    crypto.timingSafeEqual(bufferA, bufferA);
    return false;
  }
  
  return crypto.timingSafeEqual(bufferA, bufferB);
}

// ============================================
// INPUT SANITIZATION
// ============================================

/**
 * Escape special characters for SQL LIKE queries
 * Prevents LIKE injection attacks
 * 
 * @param {string} input - User input to sanitize
 * @returns {string} Escaped string safe for LIKE
 */
function escapeLikePattern(input) {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Escape special LIKE characters: %, _, and \
  return input
    .replace(/\\/g, '\\\\')  // Escape backslash first
    .replace(/%/g, '\\%')     // Escape percent
    .replace(/_/g, '\\_');    // Escape underscore
}

/**
 * Sanitize string for logging (remove sensitive data patterns)
 * 
 * @param {string} input - String that may contain sensitive data
 * @returns {string} Sanitized string safe for logging
 */
function sanitizeForLogging(input) {
  if (typeof input !== 'string') {
    return String(input);
  }
  
  // Redact common sensitive patterns
  return input
    // Redact API keys (claw_...)
    .replace(/claw_[a-f0-9]{64}/gi, 'claw_[REDACTED]')
    // Redact Stripe keys (sk_live_..., sk_test_...)
    .replace(/sk_(live|test)_[a-zA-Z0-9]+/gi, 'sk_$1_[REDACTED]')
    // Redact Bearer tokens
    .replace(/Bearer [a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
    // Redact email addresses (partial)
    .replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, (_, local) => {
      const visible = local.substring(0, 2);
      return `${visible}***@[REDACTED]`;
    });
}

// ============================================
// RATE LIMITING
// ============================================

/**
 * Create a rate limiter with configurable backend
 * In production, use Redis; in dev, use in-memory
 * 
 * @param {Object} options - Rate limit configuration
 * @returns {Object} Rate limiter instance
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 60 * 1000,  // 1 minute default
    maxRequests = 100,
    keyGenerator = (req) => req.ip || 'unknown',
    store = null,  // Pass Redis client for production
  } = options;
  
  // In-memory store (development only)
  const memoryStore = new Map();
  
  return {
    /**
     * Check if request is allowed
     * @param {Object} req - Express request
     * @returns {Object} { allowed: boolean, remaining: number, resetTime: number }
     */
    async check(req) {
      const key = keyGenerator(req);
      const now = Date.now();
      
      if (store) {
        // Redis implementation
        const multi = store.multi();
        const redisKey = `ratelimit:${key}`;
        
        multi.incr(redisKey);
        multi.pttl(redisKey);
        
        const results = await multi.exec();
        const count = results[0][1];
        const ttl = results[1][1];
        
        if (ttl === -1) {
          await store.pexpire(redisKey, windowMs);
        }
        
        return {
          allowed: count <= maxRequests,
          remaining: Math.max(0, maxRequests - count),
          resetTime: now + (ttl > 0 ? ttl : windowMs),
        };
      } else {
        // In-memory fallback
        const record = memoryStore.get(key);
        
        if (!record || now > record.resetTime) {
          memoryStore.set(key, { count: 1, resetTime: now + windowMs });
          return { allowed: true, remaining: maxRequests - 1, resetTime: now + windowMs };
        }
        
        if (record.count >= maxRequests) {
          return { allowed: false, remaining: 0, resetTime: record.resetTime };
        }
        
        record.count++;
        return {
          allowed: true,
          remaining: maxRequests - record.count,
          resetTime: record.resetTime,
        };
      }
    },
    
    /**
     * Express middleware version
     */
    middleware() {
      return async (req, res, next) => {
        const result = await this.check(req);
        
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
        
        if (!result.allowed) {
          return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
          });
        }
        
        next();
      };
    },
  };
}

// ============================================
// REQUEST VALIDATION
// ============================================

/**
 * Validate email format and domain
 * 
 * @param {string} email - Email to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }
  
  const trimmed = email.trim().toLowerCase();
  
  // Length check
  if (trimmed.length > 254) {
    return { valid: false, error: 'Email address too long' };
  }
  
  // Format check (RFC 5322 simplified)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  // Disposable domain check
  const DISPOSABLE_DOMAINS = new Set([
    'tempmail.com', 'guerrillamail.com', '10minutemail.com',
    'throwaway.email', 'temp-mail.org', 'fakeinbox.com',
    'trashmail.com', 'mailinator.com', 'maildrop.cc', 'yopmail.com',
    'tempail.com', 'dispostable.com', 'sharklasers.com', 'guerrillamail.info',
  ]);
  
  const domain = trimmed.split('@')[1];
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, error: 'Disposable email addresses are not allowed' };
  }
  
  return { valid: true, email: trimmed };
}

/**
 * Validate workspace ID format
 * 
 * @param {string} workspaceId - Workspace ID to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateWorkspaceId(workspaceId) {
  if (!workspaceId || typeof workspaceId !== 'string') {
    return { valid: false, error: 'Workspace ID is required' };
  }
  
  // Format: claw_XXXX_XXXXXXXX
  const workspaceRegex = /^claw_[a-z]{4}_[a-f0-9]{8}$/;
  if (!workspaceRegex.test(workspaceId)) {
    return { valid: false, error: 'Invalid workspace ID format' };
  }
  
  return { valid: true };
}

/**
 * Validate Stripe Price ID
 * 
 * @param {string} priceId - Price ID to validate
 * @param {Set<string>} allowedPrices - Set of allowed price IDs
 * @returns {Object} { valid: boolean, error?: string }
 */
function validatePriceId(priceId, allowedPrices) {
  if (!priceId || typeof priceId !== 'string') {
    return { valid: false, error: 'Price ID is required' };
  }
  
  // Format check
  if (!priceId.startsWith('price_') || priceId.length > 100) {
    return { valid: false, error: 'Invalid price ID format' };
  }
  
  // Whitelist check
  if (!allowedPrices.has(priceId)) {
    return { valid: false, error: 'Invalid price ID' };
  }
  
  return { valid: true };
}

// ============================================
// SECURITY LOGGING
// ============================================

/**
 * Log security events
 * 
 * @param {string} event - Event type
 * @param {Object} details - Event details
 */
function logSecurityEvent(event, details = {}) {
  const sanitizedDetails = {};
  
  for (const [key, value] of Object.entries(details)) {
    sanitizedDetails[key] = typeof value === 'string'
      ? sanitizeForLogging(value)
      : value;
  }
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    ...sanitizedDetails,
  };
  
  // In production, send to security logging service
  console.log('🔒 Security Event:', JSON.stringify(logEntry));
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // API Key handling
  generateApiKey,
  hashApiKey,
  timingSafeEqual,
  
  // Input sanitization
  escapeLikePattern,
  sanitizeForLogging,
  
  // Rate limiting
  createRateLimiter,
  
  // Validation
  validateEmail,
  validateWorkspaceId,
  validatePriceId,
  
  // Logging
  logSecurityEvent,
};
