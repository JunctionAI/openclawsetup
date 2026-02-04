# Real Provisioning System Documentation

## Overview

This is the **REAL** Clawdbot provisioning system. No mock data. Each customer gets:

1. **Railway Service** - Dedicated Node.js server
2. **Neon Database Branch** - Isolated PostgreSQL database
3. **Workspace Files** - Complete Clawdbot configuration
4. **API Key** - Secure access credentials

## Architecture

```
Customer Signs Up (Stripe)
    ↓
Webhook Triggered
    ↓
Provisioning Starts
    ├─→ Create Railway Service (Docker container)
    ├─→ Create Neon Database Branch
    ├─→ Build Workspace Structure
    ├─→ Initialize Memory System
    ├─→ Install Skills (based on plan)
    └─→ Return Credentials
    ↓
Customer Gets Access
```

## Components

### 1. Railway Provisioner (`provisioning/railway-provisioner.js`)

Creates actual Railway services via GraphQL API.

**What it does:**
- Creates new service from GitHub repo
- Configures environment variables
- Triggers deployment
- Waits for deployment to complete
- Generates public URL
- Handles scaling/resource limits

**Required Environment Variables:**
```bash
RAILWAY_TOKEN=your_railway_api_token
RAILWAY_PROJECT_ID=your_project_id
CLAWDBOT_REPO=JunctionAI/clawdbot-runtime
```

### 2. Neon Provisioner (`provisioning/neon-provisioner.js`)

Creates isolated database branches for each customer.

**What it does:**
- Creates new Neon branch (database fork)
- Initializes schema (memories, conversations, usage_tracking)
- Returns connection string
- Can delete branch on cancellation

**Required Environment Variables:**
```bash
NEON_API_KEY=your_neon_api_key
NEON_PROJECT_ID=your_neon_project_id
```

### 3. Workspace Builder (`provisioning/workspace-builder.js`)

Creates complete Clawdbot workspace with config files.

**Creates:**
- `SOUL.md` - Agent identity
- `USER.md` - Customer context
- `AGENTS.md` - Operational instructions
- `TOOLS.md` - Local notes
- `HEARTBEAT.md` - Proactive tasks
- `STATE.json` - Fast-tier state
- `MEMORY.md` - Long-term memory
- `memory/YYYY-MM-DD.md` - Daily logs
- `.env` - Environment config
- `skills/` - Skill configurations

### 4. Clawdbot Runtime (`runtime/clawdbot-server.js`)

The actual server that runs for each customer.

**Features:**
- `/api/chat` - Chat with Claude
- `/api/memory` - Store/search memories
- `/api/skills` - Manage skills
- `/webhook/:source` - Receive webhooks
- `/health` - Health checks
- `/status` - Usage stats

**Authentication:**
```
Authorization: Bearer claw_xxxxx
```

## Deployment Flow

### 1. Customer Signs Up

```javascript
// Stripe checkout completed
{
  "type": "checkout.session.completed",
  "data": {
    "customer": "cus_xxxxx",
    "email": "customer@example.com",
    "subscription": "sub_xxxxx"
  }
}
```

### 2. Webhook Handler

```javascript
// Backend receives webhook
await handleCheckoutCompleted(session)
  → Store customer in database
  → Trigger provisioning
  → Send welcome email
```

### 3. Provisioning Execution

```javascript
// Real provisioning (30-60 seconds)
const credentials = await provisionCustomer(customerId, email, planId)
  → Deploy Railway service
  → Create Neon database
  → Build workspace
  → Initialize runtime
  → Health check
  → Return credentials
```

### 4. Customer Access

```javascript
// Customer dashboard shows
{
  "workspaceId": "ws_xxxxx",
  "accessUrl": "https://xxxxx.railway.app",
  "apiKey": "claw_xxxxx"
}
```

## Plan Configuration

```javascript
const PLANS = {
  'price_1SwtCbBfSldKMuDjM3p0kyG4': {
    name: 'Starter',
    messageLimit: 5000,
    agents: 3,
    features: ['chat', 'memory', 'web_search']
  },
  'price_1SwtCbBfSldKMuDjDmRHqErh': {
    name: 'Pro',
    messageLimit: 20000,
    agents: 10,
    features: ['chat', 'memory', 'web_search', 'gmail', 'calendar', 'browser']
  },
  'price_1SwtCcBfSldKMuDjEKBqQ6lH': {
    name: 'Team',
    messageLimit: 100000,
    agents: -1,
    features: ['all']
  }
};
```

## Resource Allocation

| Plan | CPU | Memory | Database |
|------|-----|--------|----------|
| Starter | 0.5 core | 512MB | 100MB |
| Pro | 1 core | 1GB | 500MB |
| Team | 2 cores | 2GB | 2GB |

## Cost Breakdown

**Per Customer (estimated):**
- Railway: $5-20/month (depending on plan)
- Neon: $0-10/month (free tier → paid)
- Claude API: Variable (usage-based)

**Total Cost:** ~$5-30/customer/month  
**Revenue:** $29-199/customer/month  
**Margin:** ~80-90%

## Monitoring

### Health Checks

Each instance exposes:
- `GET /health` - Health status
- `GET /status` - Usage stats
- Railway auto-restarts on failure

### Usage Tracking

Stored in customer database:
```sql
SELECT * FROM usage_tracking
WHERE date >= date_trunc('month', CURRENT_DATE)
```

### Alerts

- Provisioning failures → Email + Slack
- Instance crashes → Railway auto-restart
- Usage limits → Customer notification

## Scaling

### Horizontal Scaling

Each customer = separate Railway service  
→ No shared resources  
→ Infinite scaling potential  
→ Isolated failures

### Vertical Scaling

Plans automatically allocate resources:
- Starter: 0.5 CPU, 512MB RAM
- Pro: 1 CPU, 1GB RAM
- Team: 2 CPU, 2GB RAM

## Deprovisioning

When customer cancels:

```javascript
await deprovisionCustomer(customerId, instanceData)
  → Stop Railway service
  → Delete Neon database branch
  → Archive workspace data
  → Revoke API keys
```

**Timeline:**
- Immediate: Service stopped
- 7 days: Data archived
- 30 days: Permanent deletion

## Security

### API Authentication

```bash
curl -H "Authorization: Bearer claw_xxxxx" \
  https://xxxxx.railway.app/api/chat
```

### Database Isolation

- Each customer = separate Neon branch
- No cross-customer data access
- Encrypted connections (SSL)

### Environment Variables

Never committed to code:
- `RAILWAY_TOKEN`
- `NEON_API_KEY`
- `ANTHROPIC_API_KEY`
- Customer `API_KEY`

## Testing

### Local Testing

```bash
# Set environment variables
export RAILWAY_TOKEN=xxxxx
export NEON_API_KEY=xxxxx
export ANTHROPIC_API_KEY=xxxxx

# Run provisioning test
node test-provisioning.js
```

### Staging Environment

- Separate Railway project
- Separate Neon project
- Test with Stripe test mode

## Troubleshooting

### Provisioning Fails

1. Check Railway logs
2. Check Neon status
3. Verify environment variables
4. Check GitHub repo access

### Instance Won't Start

1. Check health endpoint
2. Review Railway logs
3. Verify DATABASE_URL
4. Check ANTHROPIC_API_KEY

### Database Connection Issues

1. Verify Neon branch exists
2. Check connection string
3. Test with `psql`
4. Review SSL settings

## Future Improvements

### Phase 2
- [ ] Docker Compose option (self-hosted)
- [ ] Kubernetes deployment
- [ ] Multi-region support
- [ ] Custom domain per customer

### Phase 3
- [ ] Auto-scaling based on usage
- [ ] Database backups automation
- [ ] Real-time metrics dashboard
- [ ] Advanced monitoring & alerts

---

**Status:** ✅ Production Ready  
**Version:** 1.0.0  
**Last Updated:** 2026-02-04
