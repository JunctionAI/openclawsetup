# Clawdbot SaaS Backend

Automation backend for SimpleClaw hosted SaaS.

## Features
- Stripe webhook handling
- Automated customer provisioning
- Zero-touch setup

## Deployment
Configured for Railway auto-deploy from GitHub.

## Environment Variables
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `DATABASE_URL` - Neon PostgreSQL connection string
- `PORT` - Server port (Railway sets automatically)
