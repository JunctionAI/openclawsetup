# Real Provisioning System - Deployment Guide

## Prerequisites

1. **Railway Account** - https://railway.app
2. **Neon Account** - https://neon.tech
3. **Stripe Account** - Already configured
4. **GitHub Repo** - For Clawdbot runtime
5. **Anthropic API Key** - For Claude

## Step 1: Set Up GitHub Runtime Repository

### Create Repository

```bash
# Create new repo on GitHub
gh repo create JunctionAI/clawdbot-runtime --private

# Push runtime code
cd temp-repo/runtime
git init
git add .
git commit -m "Initial Clawdbot runtime"
git remote add origin git@github.com:JunctionAI/clawdbot-runtime.git
git push -u origin main
```

### Repository Structure

```
clawdbot-runtime/
├── clawdbot-server.js    # Main server
├── package.json          # Dependencies
├── Dockerfile            # Docker configuration
└── README.md             # Documentation
```

## Step 2: Configure Railway

### Get Railway API Token

1. Go to https://railway.app/account/tokens
2. Create new token: "Clawdbot Provisioner"
3. Copy token → Save as `RAILWAY_TOKEN`

### Create Railway Project

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create project
railway init
# Name: clawdbot-customers

# Get project ID
railway status
# Copy project ID → Save as RAILWAY_PROJECT_ID
```

### Configure Railway Project

```bash
# Add environment variables (shared across all services)
railway variables set ANTHROPIC_API_KEY="sk-ant-xxxxx"
railway variables set NODE_ENV="production"
```

## Step 3: Configure Neon

### Get Neon API Key

1. Go to https://console.neon.tech/app/settings/api-keys
2. Create new API key: "Clawdbot Provisioner"
3. Copy key → Save as `NEON_API_KEY`

### Get Project ID

```bash
# List projects
curl -H "Authorization: Bearer $NEON_API_KEY" \
  https://console.neon.tech/api/v2/projects

# Copy project ID → Save as NEON_PROJECT_ID
```

### Create Main Branch Template

```bash
# Connect to main branch
psql postgresql://xxx@xxx.neon.tech/main?sslmode=require

# Create template schema
CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT NOW()
);

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
  date DATE NOT NULL UNIQUE,
  messages_sent INT DEFAULT 0,
  api_calls INT DEFAULT 0,
  tokens_used BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_memories_agent ON memories(agent_id);
CREATE INDEX idx_conversations_agent ON conversations(agent_id);
CREATE INDEX idx_usage_date ON usage_tracking(date);
```

## Step 4: Deploy Backend with Real Provisioning

### Update Environment Variables

Add to Railway backend service:

```bash
# Railway API
RAILWAY_TOKEN=rp_xxxxx
RAILWAY_PROJECT_ID=xxxxx
CLAWDBOT_REPO=JunctionAI/clawdbot-runtime

# Neon API
NEON_API_KEY=xxxxx
NEON_PROJECT_ID=xxxxx

# Existing variables (already set)
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
DATABASE_URL=postgresql://xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### Deploy Updated Code

```bash
cd temp-repo

# Push to GitHub (already connected to Railway)
git add provisioning/
git add runtime/
git add docs/
git commit -m "Add real provisioning system"
git push

# Railway will auto-deploy
```

### Verify Deployment

```bash
# Check Railway logs
railway logs

# Test provisioning endpoint
curl https://empathetic-dream-production-3f64.up.railway.app/health
```

## Step 5: Test Real Provisioning

### Create Test Customer

```bash
# Use Stripe test mode first
# Go to dashboard, click "Start Free Trial"
# Use test card: 4242 4242 4242 4242

# Or trigger manually via backend
curl -X POST https://empathetic-dream-production-3f64.up.railway.app/api/provision-test \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "plan": "price_1SwtCbBfSldKMuDjM3p0kyG4"
  }'
```

### Monitor Provisioning

Watch Railway logs:
```bash
railway logs -f
```

Expected output:
```
🚀 [REAL PROVISION] Starting for test@example.com
📦 [STEP 1/5] Deploying Railway service...
✅ Railway service deployed: xxxxx
📁 [STEP 2/5] Building workspace...
✅ Workspace built: /var/clawdbot/workspaces/ws_xxxxx
🗄️  [STEP 3/5] Creating customer database...
✅ Database created: br_xxxxx
🤖 [STEP 4/5] Initializing Clawdbot runtime...
✅ Clawdbot runtime initialized
🏥 [STEP 5/5] Running health check...
✅ Instance is healthy and responding
✅ [PROVISION COMPLETE] test@example.com provisioned in 47.3s
```

### Verify Instance

```bash
# Get customer instance URL from logs
INSTANCE_URL="https://xxxxx.railway.app"

# Test health
curl $INSTANCE_URL/health

# Test chat (with API key from logs)
curl -X POST $INSTANCE_URL/api/chat \
  -H "Authorization: Bearer claw_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

## Step 6: Production Cutover

### Switch to Live Mode

1. **Stripe:** Switch webhook to live mode
2. **Test:** Create real subscription with real card
3. **Verify:** Full end-to-end provisioning works
4. **Monitor:** Watch first few customers closely

### Rollback Plan

If provisioning fails:

```bash
# 1. Switch back to old system (mock provisioning)
git revert HEAD
git push

# 2. Fix issues
# 3. Redeploy

# 4. Cleanup failed provisions
node scripts/cleanup-failed-provisions.js
```

## Step 7: Monitoring & Alerts

### Set Up Alerts

```javascript
// Add to backend
const { sendAlert } = require('./alerts');

try {
  await provisionCustomer(customerId, email, plan);
} catch (error) {
  await sendAlert({
    type: 'provisioning_failed',
    customer: email,
    error: error.message
  });
}
```

### Monitor Railway

1. Railway Dashboard → Metrics
2. Set up usage alerts
3. Monitor deployment logs
4. Track resource usage

### Monitor Neon

1. Neon Console → Metrics
2. Check branch count
3. Monitor database size
4. Watch connection pool

## Step 8: Cost Management

### Railway Costs

- Base: $5/month per project
- Services: ~$5/month per customer (Starter)
- Scaling: Auto-scales up with usage

**Estimate:** $10-30/customer/month

### Neon Costs

- Free tier: 10 branches (10 customers)
- Pro: $19/month + $0.10/GB
- Scale: $69/month + $0.08/GB

**Estimate:** $0-10/customer/month

### Total Margins

| Plan | Revenue | Costs | Margin |
|------|---------|-------|--------|
| Starter | $29 | ~$8 | 72% |
| Pro | $79 | ~$15 | 81% |
| Team | $199 | ~$25 | 87% |

## Troubleshooting

### "Railway API authentication failed"

- Check `RAILWAY_TOKEN` is valid
- Regenerate token if needed
- Verify project permissions

### "Neon branch creation failed"

- Check `NEON_API_KEY` is valid
- Verify project has capacity
- Check Neon account limits

### "Deployment timeout"

- Check Railway service logs
- Verify GitHub repo access
- Check Dockerfile syntax
- Increase timeout in code

### "Health check failed"

- Verify DATABASE_URL is set
- Check ANTHROPIC_API_KEY
- Review instance logs
- Test database connection

## Next Steps

### Phase 1 (Week 1)
- [x] Deploy real provisioning system
- [ ] Test with 5-10 customers
- [ ] Monitor stability
- [ ] Fix any issues

### Phase 2 (Week 2-3)
- [ ] Add customer dashboard
- [ ] Usage tracking & limits
- [ ] Billing portal
- [ ] Email notifications

### Phase 3 (Month 2)
- [ ] Auto-scaling
- [ ] Multi-region
- [ ] Advanced monitoring
- [ ] Customer analytics

---

**Ready to deploy?** Follow steps 1-6 in order. Test thoroughly before production.

**Questions?** Check logs, review docs, test in staging first.

**Status:** 🚀 Ready for deployment
