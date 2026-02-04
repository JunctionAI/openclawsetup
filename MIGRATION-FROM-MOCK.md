# Migration from Mock to Real Provisioning

## Current State (Mock System)

Your current system returns fake data:

```javascript
// Old (Mock)
{
  "workspaceId": "ws_fake_123",
  "instanceId": "inst_mock",
  "accessUrl": "https://app.setupclaw.com/fake",
  "apiKey": "claw_mock_key"
}
```

**Problems:**
- Customers can't actually use their instances
- No real infrastructure created
- No working chat/memory/skills
- Success page shows fake credentials

## New State (Real System)

The real system creates actual infrastructure:

```javascript
// New (Real)
{
  "workspaceId": "ws_cus_abc123_1707432000",
  "instanceId": "srv_railway_xyz789",
  "accessUrl": "https://clawdbot-abc123.railway.app",
  "apiKey": "claw_a1b2c3d4e5f6g7h8..."
}
```

**Benefits:**
- Real Railway service running for each customer
- Real PostgreSQL database (Neon branch)
- Working chat, memory, skills
- Customer can actually use Clawdbot

## Migration Steps

### Step 1: Backup Current System

```bash
# Backup current code
git branch backup-mock-system
git push origin backup-mock-system

# Export current customer database
pg_dump $DATABASE_URL > backup-customers.sql
```

### Step 2: Set Up Infrastructure

Follow **[DEPLOYMENT-GUIDE.md](docs/DEPLOYMENT-GUIDE.md)**:

1. Create Railway API token
2. Create Neon API key
3. Set up GitHub runtime repository
4. Configure environment variables

### Step 3: Update Backend Code

```bash
cd temp-repo

# Replace old provisioning with real system
git rm provisioning/index.js
git mv provisioning/index-real.js provisioning/index.js

# Update index.js imports
# Change: require('./provisioning/index-real')
# To: require('./provisioning/index')
```

### Step 4: Deploy Updates

```bash
# Add new files
git add provisioning/
git add runtime/
git add docs/

# Commit changes
git commit -m "Migrate to real provisioning system"

# Push to Railway
git push

# Railway will auto-deploy
```

### Step 5: Test with Test Account

```bash
# Run test suite
node test-provisioning.js

# Expected: Real Railway service + Neon database created
```

### Step 6: Handle Existing Customers

**Option A: Grandfather Existing (Recommended)**
- Keep existing mock customers as-is
- Only new signups get real provisioning
- Gradually migrate existing customers

**Option B: Batch Migration**
- Provision real instances for existing customers
- Send migration emails
- Update database records

**Option C: Clean Slate**
- Refund/cancel existing test customers
- Start fresh with real provisioning only

### Step 7: Update Frontend

Update success page to use real URLs:

```javascript
// Before
<p>Access your workspace at: https://app.setupclaw.com/{workspaceId}</p>

// After
<p>Access your workspace at: {accessUrl}</p>
<p>API Key: {apiKey}</p>
```

### Step 8: Monitor First Real Customers

Watch Railway logs closely:

```bash
railway logs -f

# Look for:
# ✅ [PROVISION COMPLETE] customer@email.com provisioned in 42.3s
```

Check Neon dashboard:
- New branches should appear
- Database size should be ~100KB per customer

### Step 9: Rollback Plan (If Needed)

If something goes wrong:

```bash
# Switch back to mock system
git checkout backup-mock-system
git push --force

# Or just revert the commit
git revert HEAD
git push
```

## Code Changes Required

### 1. Update Main Backend (index.js)

```javascript
// OLD
const { provisionCustomer } = require('./provisioning');

// NEW
const { provisionCustomer } = require('./provisioning/index-real');
```

### 2. Update Database Schema

Add new fields:

```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS database_branch_id VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS railway_service_id VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS provisioning_status VARCHAR(50) DEFAULT 'pending';
```

### 3. Update Success Page Polling

```javascript
// OLD - Checks for fake data
if (customer.workspace_id) { /* ready */ }

// NEW - Checks for real data AND health
if (customer.workspace_id && customer.provisioning_status === 'active') {
  // Also check instance health
  const health = await fetch(`${customer.access_url}/health`);
  // ...
}
```

## Testing Checklist

Before going live:

- [ ] Test provisioning with test customer
- [ ] Verify Railway service created
- [ ] Verify Neon branch created
- [ ] Verify workspace files generated
- [ ] Test health endpoint
- [ ] Test chat API
- [ ] Test memory API
- [ ] Test deprovisioning
- [ ] Test plan upgrades/downgrades
- [ ] Monitor provisioning time (<60s)
- [ ] Check error handling
- [ ] Verify cleanup on failure

## Common Issues

### "Railway API authentication failed"

```bash
# Check token is valid
railway whoami

# Regenerate if needed
# Go to: https://railway.app/account/tokens
```

### "Neon branch creation failed"

```bash
# Check Neon limits
curl -H "Authorization: Bearer $NEON_API_KEY" \
  https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID

# Free tier: 10 branches max
# Upgrade to Pro if needed
```

### "Deployment timeout"

- Increase timeout in `railway-provisioner.js`
- Check Railway service logs
- Verify GitHub repo access
- Check Dockerfile syntax

## Cost Implications

**Before (Mock):**
- Infrastructure cost: $0
- Can't charge customers (no value delivered)

**After (Real):**
- Infrastructure cost: ~$5-30/customer/month
- Can charge customers (real value delivered)
- Margins: 72-87%

**At 10 customers:**
- Revenue: $290-1990/month
- Costs: $50-300/month
- Profit: $240-1690/month

**At 100 customers:**
- Revenue: $2,900-19,900/month
- Costs: $500-3,000/month
- Profit: $2,400-16,900/month

## Timeline

| Day | Task |
|-----|------|
| Day 1 | Set up Railway + Neon access, deploy runtime repo |
| Day 2 | Update backend code, test provisioning |
| Day 3 | Deploy to production, test end-to-end |
| Day 4 | Monitor first real customers |
| Day 5+ | Scale, optimize, improve |

## Success Criteria

✅ **Week 1:**
- Real provisioning working
- 5-10 customers successfully provisioned
- <60s provisioning time
- No major failures

✅ **Month 1:**
- 50+ customers
- <5% provisioning failure rate
- Positive customer feedback
- $1K+ MRR

## Next Steps After Migration

1. **Add Customer Dashboard** - Let customers manage their instance
2. **Usage Tracking** - Enforce message limits
3. **Billing Portal** - Self-service subscription management
4. **OAuth Flows** - Gmail/Calendar self-service setup
5. **Team Features** - Shared workspaces, seat management

---

**Ready to migrate?** Follow steps 1-9. Test thoroughly. Monitor closely.

**Questions?** Check logs, review docs, test in staging first.
