# Ally Bot Setup Guide

Multi-tenant Telegram bot where ONE bot (@AllyBot) serves ALL users.

## Architecture

```
User sends message to @AllyBot
        ↓
Telegram webhook → /api/ally/webhook
        ↓
Look up user by telegram_id
        ↓
┌──────────────────────┬─────────────────────────┐
│   New User           │   Linked User           │
├──────────────────────┼─────────────────────────┤
│ Prompt to sign up    │ Route to workspace      │
│ at website           │ Get conversation history│
│                      │ Call Claude API         │
│                      │ Store in their workspace│
│                      │ Send response           │
└──────────────────────┴─────────────────────────┘
```

## Database Tables

- `ally_workspaces` - User workspaces with link codes
- `ally_users` - User accounts (email, Google auth)
- `ally_telegram_links` - Maps telegram_id → workspace
- `ally_conversations` - Per-workspace chat history
- `ally_usage` - Usage tracking for billing

## Setup Steps

### 1. Create Telegram Bot

1. Message @BotFather on Telegram
2. Send `/newbot`
3. Name it "Ally" or similar
4. Get the bot token (looks like `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`)

### 2. Configure Environment

Add to Railway (or .env):

```env
# Required
ALLY_BOT_TOKEN=your_telegram_bot_token
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...

# Optional but recommended
WEBSITE_URL=https://setupclaw.com
BACKEND_URL=https://your-app.railway.app
ADMIN_API_KEY=your_secret_admin_key
```

### 3. Deploy to Railway

```bash
railway up
```

### 4. Set Up Webhook

Call the setup endpoint:

```bash
curl -X POST https://your-app.railway.app/api/ally/setup-webhook \
  -H "Content-Type: application/json" \
  -d '{"adminKey": "your_secret_admin_key"}'
```

Or use the Railway shell:
```bash
curl -X POST localhost:3000/api/ally/setup-webhook -H "Content-Type: application/json" -d '{"adminKey":"YOUR_KEY"}'
```

### 5. Verify Webhook

```bash
curl https://your-app.railway.app/api/ally/webhook-info
```

Should show:
```json
{
  "url": "https://your-app.railway.app/api/ally/webhook",
  "has_custom_certificate": false,
  "pending_update_count": 0
}
```

## User Flow

### New User

1. User finds @AllyBot on Telegram
2. Sends `/start`
3. Bot responds with signup link
4. User goes to website, signs up with Google
5. Website creates workspace with link code (via `/api/ally/create-workspace`)
6. User copies code
7. User sends `/start CODE` to bot
8. Bot links their telegram_id to workspace
9. User can now chat!

### Returning User

1. User sends message to @AllyBot
2. Bot looks up telegram_id → workspace
3. Bot retrieves conversation history
4. Claude generates response with context
5. Response sent to user
6. Everything stored in their workspace

## API Endpoints

### POST /api/ally/webhook
Telegram webhook - receives all messages.

### POST /api/ally/create-workspace
Create workspace for new user (called by web frontend).

```json
{
  "email": "user@example.com",
  "name": "User Name",
  "googleId": "google_user_id"
}
```

Returns:
```json
{
  "success": true,
  "workspaceId": "ws_abc123",
  "linkCode": "ABC123",
  "telegramLinked": false
}
```

### GET /api/ally/link-status
Check if user's Telegram is linked.

Query params: `?email=user@example.com` or `?workspaceId=ws_abc123`

### POST /api/ally/setup-webhook
Set up Telegram webhook (admin only).

### GET /api/ally/webhook-info
Get current webhook status.

## Bot Commands

- `/start` - Welcome message with signup instructions
- `/start CODE` - Link Telegram to account
- `/help` - Show available commands
- `/status` - Show account status
- `/unlink` - Disconnect Telegram from account

## Memory Isolation

Each user's data is completely isolated:
- Conversations stored with `workspace_id`
- Memories loaded per workspace
- No cross-workspace data leakage

## Troubleshooting

### Bot not responding
1. Check webhook is set: `GET /api/ally/webhook-info`
2. Check Railway logs for errors
3. Verify ALLY_BOT_TOKEN is correct

### Link code not working
1. Check code isn't expired
2. Check workspace exists and is active
3. Check for typos (codes are case-insensitive)

### AI not responding
1. Check ANTHROPIC_API_KEY is set
2. Check usage limits
3. Check Railway logs for API errors
