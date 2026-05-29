# TONanza

TONanza is a Telegram Mini App for secure deal management. The backend validates Telegram WebApp init data, stores deals and chat history in PostgreSQL, streams deal updates through Socket.IO, and lets admins coordinate requisites, notifications, photos, and deal closure from a compact mobile UI.

## Stack

- Node.js 20, TypeScript, Fastify
- Prisma ORM and PostgreSQL
- Telegraf for Telegram bot entry points
- Socket.IO for real-time deal updates
- React 19, Vite, Tailwind/PostCSS
- Docker Compose for local infrastructure and production backend runtime

## Features

- Telegram WebApp authentication with HMAC signature validation
- Admin allow-list through `ADMIN_TELEGRAM_IDS`
- Deal creation with short shareable codes
- Participant auto-join by deal code
- Persistent deal chat with text and image messages
- Admin-only requisites, notifications, and close actions
- Real-time updates per deal room
- Local dev auth bypass outside production

## Repository Layout

```text
.
├── src/                  # Fastify API, Telegram bot, domain services
├── prisma/               # Prisma schema and migrations
├── frontend/             # Telegram Mini App client
├── Dockerfile            # Production backend image
├── docker-compose.yml    # PostgreSQL + backend runtime
└── deploy.sh             # Optional SSH deploy helper
```

## Local Development

Requirements:

- Node.js 20+
- npm 10+
- Docker Desktop or a local PostgreSQL instance

Start PostgreSQL:

```bash
docker compose up -d postgres
```

Install dependencies:

```bash
npm ci
npm --prefix frontend ci
```

Create local env files:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

Run migrations and generate Prisma client:

```bash
npm run prisma:generate
npm run prisma:migrate
```

Run backend and frontend in separate terminals:

```bash
npm run dev
npm run frontend:dev
```

For browser-based local preview, the frontend sends `x-bypass-auth` only outside production. Real Telegram sessions use `X-Telegram-Init-Data` and require `TELEGRAM_BOT_TOKEN`.

## Environment

Backend variables:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | API port, defaults to `3000` |
| `POSTGRES_USER` | PostgreSQL user for Docker Compose |
| `POSTGRES_PASSWORD` | PostgreSQL password for Docker Compose |
| `POSTGRES_DB` | PostgreSQL database for Docker Compose |
| `DATABASE_URL` | PostgreSQL connection string |
| `FRONTEND_URL` | Public Mini App URL used by the bot |
| `TELEGRAM_BOT_TOKEN` | Bot token used for auth validation and notifications |
| `ADMIN_TELEGRAM_IDS` | Comma-separated Telegram user IDs with admin access |
| `CORS_ORIGINS` | Extra allowed frontend origins |
| `UPLOAD_DIR` | Local image upload directory |
| `MAX_UPLOAD_MB` | Upload limit per file, max `25` |

Frontend variables:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Backend API origin |
| `VITE_SOCKET_URL` | Socket.IO origin; falls back to API origin when omitted |

## Quality Gates

```bash
npm run check
```

The check command runs backend type checking and a production frontend build.

## Docker

Run the backend and database:

```bash
docker compose --env-file .env up -d --build
```

Apply migrations inside the backend container:

```bash
docker compose --env-file .env exec backend npx prisma migrate deploy
```

The frontend is intentionally built as a static artifact and can be served by Nginx, CDN, or any static host.

## Deployment Helper

`deploy.sh` is an optional SSH helper. It expects explicit runtime configuration instead of hardcoded machine-specific values:

```bash
SERVER_IP=203.0.113.10 \
SSH_KEY="$HOME/.ssh/tonanza" \
PUBLIC_ORIGIN="https://tonanza.example" \
./deploy.sh
```

Production should keep secrets in `.env` or the deployment platform secret store. `.env` files are ignored by git.
