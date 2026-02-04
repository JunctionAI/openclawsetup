# Ally Bot Setup Guide

## Overview

Ally is a managed, multi-tenant Telegram bot. Unlike the BYOB (Bring Your Own Bot) model, we run **one bot** (@AllyBot) that serves all users. Users sign up via the web, get a unique code, and link their Telegram to their workspace.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web Setup     │────▶│   Backend API   │────▶│    Database     │
│   /setup page   │     │   (Railway)     │     │    (Neon)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               ▲
                               │
                        ┌──────┴──────┐
                        │  Telegram   │
                        │  @AllyBot   │
                        └─────────────┘
```

## Flow

1. **User visits /setup** on the dashboard
2. **Signs in with Google** → workspace created in DB
3. **Gets unique 6-char code** (e.g., `AB12CD`)
4. **Clicks "Connect to Telegram"** → opens `t.me/AllyBot?start=AB12CD`
5. **Sends /start AB12CD** to @AllyBot
6. **Bot links Telegram ID to workspace** in DB
7. **User can now chat with Ally** → messages routed to their workspace

## Environment Variables

### Required for Ally Bot

```bash
# Telegram bot token for @AllyBot
# Get from @BotFather on Telegram
ALLY_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrstuvwxyz

# Backend URL (for webhook)
BACKEND_URL=https://your-backend.railway.app

# Admin API key (for setup endpoints)
ADMIN_API_KEY=your-secret-key

# Anthropic API key (for AI responses)
ANTHROPIC_API_KEY=sk-ant-xxx
```

### Existing Backend Vars (already configured)
- `DATABASE_URL` - Neon PostgreSQL
- `STRIPE_SECRET_KEY` - Stripe API
- `STRIPE_WEBHOOK_SECRET` - Stripe webhooks

## Database Tables

The backend creates these tables automatically:

### ally_workspaces
```sql
CREATE TABLE ally_workspaces (
  id VARCHAR(255) PRIMARY KEY,
  link_code VARCHAR(10) UNIQUE NOT NULL,
  api_key VARCHAR(255) UNIQUE,
  plan VARCHAR(50) DEFAULT 'free',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ally_users
```sql
CREATE TABLE ally_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  google_id VARCHAR(255),
  workspace_id VARCHAR(255) REFERENCES ally_workspaces(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ally_telegram_links
```sql
CREATE TABLE ally_telegram_links (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(255) REFERENCES ally_workspaces(id),
  telegram_user_id VARCHAR(100) UNIQUE NOT NULL,
  telegram_username VARCHAR(100),
  telegram_first_name VARCHAR(255),
  telegram_chat_id VARCHAR(100),
  linked_at TIMESTAMP DEFAULT NOW()
);
```

### ally_conversations
```sql
CREATE TABLE ally_conversations (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(255) NOT NULL,
  telegram_user_id VARCHAR(100),
  message TEXT NOT NULL,
  role VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints

### POST /api/ally/create-workspace
Create a workspace for an authenticated user.

**Request:**
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "googleId": "google-user-id"
}
```

**Response:**
```json
{
  "success": true,
  "workspaceId": "ws_abc123",
  "linkCode": "AB12CD",
  "telegramLinked": false
}
```

### GET /api/ally/link-status
Check if user's Telegram is linked.

**Query params:** `email` or `workspaceId`

**Response:**
```json
{
  "linked": true,
  "workspaceId": "ws_abc123",
  "telegram": {
    "userId": "123456789",
    "username": "johndoe",
    "firstName": "John"
  }
}
```

### POST /api/ally/webhook
Telegram webhook endpoint. Receives all messages to @AllyBot.

### POST /api/ally/setup-webhook
Admin endpoint to configure Telegram webhook.

**Request:**
```json
{
  "adminKey": "your-admin-api-key"
}
```

## Setup Instructions

### 1. Create the Telegram Bot

1. Open Telegram and message @BotFather
2. Send `/newbot`
3. Name it "Ally" and username `AllyBot` (or similar)
4. Copy the bot token

### 2. Configure Environment Variables

In Railway (or your hosting):

```bash
ALLY_BOT_TOKEN=your-bot-token
BACKEND_URL=https://your-backend.railway.app
ADMIN_API_KEY=generate-a-random-key
ANTHROPIC_API_KEY=sk-ant-xxx
```

### 3. Deploy Backend

```bash
# Push to Railway
git push
```

The database tables are created automatically on startup.

### 4. Setup Webhook

Run the setup script:

```bash
node scripts/setup-ally-webhook.js
```

Or call the API:

```bash
curl -X POST https://your-backend.railway.app/api/ally/setup-webhook \
  -H "Content-Type: application/json" \
  -d '{"adminKey": "your-admin-api-key"}'
```

### 5. Configure Dashboard

Add to Vercel environment:

```bash
NEXT_PUBLIC_BACKEND_URL=https://your-backend.railway.app
```

### 6. Test the Flow

1. Visit `/setup` on your dashboard
2. Sign in with Google
3. Click "Connect to Telegram"
4. Send `/start [code]` to @AllyBot
5. Start chatting!

## Troubleshooting

### "Invalid or expired code"
- Code is case-insensitive but must be exact
- Check if workspace exists in DB
- Ensure workspace status is 'active'

### No response from bot
- Check webhook is set: `GET /api/ally/webhook-info`
- Verify ALLY_BOT_TOKEN is correct
- Check Railway logs for errors

### "Your account is inactive"
- User's workspace status changed
- May need to reactivate subscription

## Security Notes

- Link codes are 6-char hex (16M possibilities)
- Codes don't expire but can only link one Telegram account
- Users can re-link by using a new code
- API key is generated per workspace for future API access
- Conversations are stored per-workspace for context
