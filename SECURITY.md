# Security Audit Report - Clawdbot/Ally

**Audit Date:** 2025-01-27  
**Auditor:** Security Subagent  
**Scope:** Dashboard (Next.js) + Backend API (Express)

---

## Executive Summary

Overall security posture: **MODERATE** ⚠️

The codebase implements several security best practices including:
- Stripe webhook signature verification
- Rate limiting on critical endpoints
- CORS whitelisting
- CSP headers
- Parameterized SQL queries

However, critical gaps exist that require immediate attention:
- Missing authentication on dashboard/customer endpoints
- API keys stored as plaintext in database
- Weak SSL certificate validation
- In-memory rate limiting (won't scale)

---

## Findings by Category

### 1. Authentication Flows ❌ CRITICAL

| Issue | Severity | Status |
|-------|----------|--------|
| Customer API returns mock data without auth | 🔴 Critical | Open |
| No session-based auth for dashboard | 🔴 Critical | Open |
| API key comparison not timing-safe | 🟡 Medium | Fixed |

**Details:**

**SEC-001: Customer API Missing Authentication**
- File: `dashboard/app/api/customer/route.ts`
- Current code returns mock data with TODO comment
- Recommendation: Implement session-based authentication or JWT

**SEC-002: Dashboard Auth Missing**
- File: `dashboard/middleware.ts`
- Protected routes defined but not enforced
- Auth check logic never implemented

**SEC-003: Timing-Safe API Key Comparison**
- File: `temp-repo/api/workspace.js`
- Direct string comparison in SQL query is timing-safe via DB
- However, should use `crypto.timingSafeEqual()` for application-level checks

### 2. API Key Handling ⚠️ HIGH

| Issue | Severity | Status |
|-------|----------|--------|
| API keys stored as plaintext | 🔴 Critical | Open |
| API key visible in welcome email | 🟡 Medium | By design |
| No key rotation mechanism | 🟡 Medium | Open |

**Details:**

**SEC-004: Plaintext API Key Storage**
- File: `temp-repo/index.js` (line 293)
- API keys stored directly in `customers.api_key` column
- Recommendation: Hash with bcrypt/argon2, only show once at generation

**SEC-005: Key Rotation**
- No endpoint for rotating API keys
- Recommendation: Add `/api/workspace/:id/rotate-key` endpoint

### 3. User Data Protection ⚠️ HIGH

| Issue | Severity | Status |
|-------|----------|--------|
| SSL rejectUnauthorized: false | 🟡 Medium | Open |
| No encryption at rest documented | 🟡 Medium | Open |
| PII logged in console | 🟢 Low | Partial |

**Details:**

**SEC-006: Weak SSL Validation**
- File: `temp-repo/index.js` (line 51)
- `ssl: { rejectUnauthorized: false }` allows MITM attacks
- Recommendation: Use proper CA certificate or trusted connection

**SEC-007: Data Encryption**
- Email addresses stored as plaintext (acceptable)
- API keys should be hashed (see SEC-004)
- Consider column-level encryption for sensitive metadata

### 4. Stripe Webhook Verification ✅ GOOD

| Issue | Severity | Status |
|-------|----------|--------|
| Signature verification implemented | ✅ | Good |
| Idempotency checking present | ✅ | Good |
| Raw body handling correct | ✅ | Good |

**Details:**

The webhook implementation correctly:
- Uses `express.raw()` before JSON parsing
- Calls `stripe.webhooks.constructEvent()` with signature
- Checks for duplicate webhooks via `checkout_session_id`

### 5. Rate Limiting ⚠️ MEDIUM

| Issue | Severity | Status |
|-------|----------|--------|
| In-memory rate limiting | 🟡 Medium | Open |
| No distributed rate limit | 🟡 Medium | Open |
| Good per-endpoint limits | ✅ | Good |

**Current Limits:**
- Global API: 100 requests/minute
- Checkout: 10 requests/hour
- Subscribe: 5 requests/hour

**Details:**

**SEC-008: In-Memory Rate Limiting**
- All rate limit maps reset on server restart
- Won't work with multiple server instances
- Recommendation: Use Redis-based rate limiting (e.g., `express-rate-limit` with `rate-limit-redis`)

### 6. Input Validation ⚠️ MEDIUM

| Issue | Severity | Status |
|-------|----------|--------|
| SQL injection protected | ✅ | Good |
| LIKE injection possible | 🟡 Medium | Fixed |
| Email validation good | ✅ | Good |
| Price ID whitelist | ✅ | Good |
| Message length limit | ✅ | Good |

**Details:**

**SEC-009: LIKE Injection**
- File: `temp-repo/api/workspace.js` (line 300)
- Memory search uses `ILIKE '%${query}%'`
- User can inject `%` and `_` wildcards
- Fixed: Escape special LIKE characters

**Good Practices Found:**
- Disposable email domain blocking
- Price ID whitelist with hardcoded fallbacks
- Message length limit (32000 chars)

### 7. CORS and CSP Headers ⚠️ MEDIUM

| Issue | Severity | Status |
|-------|----------|--------|
| CORS whitelist implemented | ✅ | Good |
| CSP allows unsafe-inline/eval | 🟡 Medium | Acceptable |
| Security headers present | ✅ | Good |

**Current CSP:**
```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: https: blob:;
connect-src 'self' https://api.stripe.com wss: ws:;
frame-src 'self' https://js.stripe.com;
```

**Details:**

**SEC-010: CSP Weaknesses**
- `unsafe-inline` and `unsafe-eval` needed for Next.js
- Consider using nonces for script-src in production
- Add `form-action 'self'` to prevent form hijacking
- Add `base-uri 'self'` to prevent base tag injection

**Good Headers Present:**
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy (camera, microphone, geolocation blocked)

---

## Recommended Fixes (Priority Order)

### 🔴 Critical (Do Immediately)

1. **Implement Dashboard Authentication**
   - Add NextAuth.js or custom session handling
   - Protect `/dashboard/*` routes properly

2. **Hash API Keys**
   - Use bcrypt/argon2 for storing API keys
   - Only display key once at creation time

3. **Fix SSL Certificate Validation**
   - Remove `rejectUnauthorized: false`
   - Use proper Neon SSL configuration

### 🟡 High Priority (This Week)

4. **Add Redis Rate Limiting**
   - Replace in-memory Maps with Redis
   - Ensure rate limits survive restarts

5. **Sanitize LIKE Queries**
   - Escape `%`, `_`, and `\` in search inputs

6. **Add API Key Rotation**
   - Create endpoint to regenerate keys
   - Invalidate old key on rotation

### 🟢 Medium Priority (This Month)

7. **Strengthen CSP**
   - Use nonces instead of unsafe-inline
   - Add form-action and base-uri

8. **Add Security Logging**
   - Log auth failures
   - Log rate limit hits
   - Create audit trail

9. **Implement Session Management**
   - Add session timeout
   - Add concurrent session limits
   - Add logout functionality

---

## Files Changed in This Audit

1. `dashboard/SECURITY.md` - This report (created)
2. `temp-repo/lib/security.js` - Security utilities (created)
3. `temp-repo/api/workspace.js` - Fixed LIKE injection (updated)

---

## Compliance Notes

- **PCI DSS**: No card data stored locally (Stripe handles all PCI concerns) ✅
- **GDPR**: Email stored, consider adding data export/deletion endpoints
- **SOC 2**: Would need formal policies and logging improvements

---

## Next Audit Scheduled

Recommend follow-up audit in 30 days after implementing critical fixes.
