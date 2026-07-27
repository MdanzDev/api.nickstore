# NickStore API Server

Standalone backend API server for the NickStore top-up platform. Handles bot API endpoints, Kryz-Net provider proxy, cron sync jobs, and webhook callbacks.

## Architecture

```
Telegram Bot (nickteletop)
        |
        | HMAC-signed requests
        v
NickStore API Server (api.nickstore)  <-- THIS SERVER
        |
        | Supabase queries + Kryz-Net proxy
        v
┌──────────────────┐    ┌─────────────────┐
│  Supabase (DB)   │    │  Kryz-Net API   │
│  PostgreSQL      │    │  Game Provider   │
└──────────────────┘    └─────────────────┘
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| GET | `/api/products` | None | Product catalog |
| POST | `/api/account/validate` | HMAC | Validate game nickname |
| POST | `/api/order/create` | HMAC | Create order (atomic wallet lock) |
| GET | `/api/order/status/:id` | HMAC | Check order status |
| GET | `/api/user/account/:telegram_id` | HMAC | Get user profile |
| GET | `/api/user/history/:telegram_id` | HMAC | Transaction history |
| POST | `/api/auth/otp/send` | None | Send OTP |
| POST | `/api/auth/otp/verify` | None | Verify OTP |
| POST | `/api/admin/refund` | Admin | Process refund |
| GET | `/api/admin/provider/balance` | Admin | Check supplier balance |
| POST | `/api/cron/products-sync` | None | Sync products from Kryz-Net |
| ALL | `/api/cron/sync` | CRON_SECRET | Sync pending orders |
| ALL | `/api/callback` | None | Webhook callback forwarding |
| ALL | `/api/v1/*` | Passthrough | Proxy to Kryz-Net API |
| GET | `/img/:filename` | None | Image proxy |

## Security

- **HMAC-SHA256**: Bot requests require `X-Bot-ID`, `X-Timestamp`, `X-Signature` headers
- **Timing-safe comparison**: Uses `crypto.timingSafeEqual` to prevent timing attacks
- **Replay protection**: 5-minute timestamp window
- **Admin auth**: Bearer token or HMAC signature

## Setup

```bash
# Install
npm install

# Copy env
cp .env.example .env
# Edit .env with your credentials

# Development
npm run dev

# TypeScript check
npm run typecheck

# Production build
npm run build
npm start
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 4000) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `EXTERNAL_API_URL` | Kryz-Net API base URL |
| `EXTERNAL_API_KEY` | Kryz-Net API key |
| `BOT_SECRET` | Shared secret for HMAC signing |
| `CRON_SECRET` | Secret for cron job auth |
| `CRON_ADMIN_EMAIL` | Admin email for cron sync |
| `CRON_ADMIN_PASSWORD` | Admin password for cron sync |

## Tech Stack

- **Runtime**: Node.js
- **Framework**: [Hono](https://hono.dev)
- **Database**: [Supabase](https://supabase.com) (PostgreSQL)
- **Language**: TypeScript
- **Provider**: Kryz-Net API V1

## Deployment

Deploy to Railway, Render, Fly.io, or any Node.js host:

```bash
npm run build
npm start
```

Set environment variables in your platform's dashboard.
