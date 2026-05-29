# TONanza

TONanza is a Telegram Mini App for a TON-based jackpot casino experience. Players enter fast PvP jackpot rounds, place TON-denominated bets, watch the live pot grow, and see the winner selected through a provably-fair round flow.

The project is built as a full-stack TypeScript product: a mobile-first Telegram WebApp client, a Node.js backend, PostgreSQL persistence, Socket.IO realtime updates, TON wallet/deposit infrastructure, game history, referrals, and in-game chat.

## Stack

- Node.js 20, TypeScript, Fastify
- PostgreSQL and Prisma ORM
- Socket.IO for live game state and chat updates
- Telegram Mini Apps / Telegram WebApp SDK
- TON wallet, deposit watcher, and payout service modules
- React 18, Vite, Tailwind/PostCSS
- Docker and Docker Compose for deployment

## Product Scope

- Jackpot PvP game loop with active rounds and winner history
- TON-denominated betting UI with compact mobile controls
- Provably-fair seed utilities for transparent winner selection
- Real-time pot, players, roulette, chat, and round-state updates
- TON payment/deposit UX for Telegram Mini App users
- Referral and onboarding flows
- Admin/moderation foundations for chat and operational control
- Production-oriented repository setup: Docker, env examples, docs, and build checks

## Repository Layout

```text
.
├── src/
│   ├── game/             # Jackpot round and provably-fair game domain
│   ├── wallet/           # TON deposit, entropy, and payout services
│   ├── chat/             # In-game chat schemas, moderation, persistence
│   ├── bot/              # Telegram bot integration
│   └── server.ts         # Fastify application entrypoint
├── frontend/             # Telegram Mini App casino client
├── prisma/               # Prisma schema and migrations
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

Generate Prisma client and run migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

Run backend and frontend in separate terminals:

```bash
npm run dev
npm run frontend:dev
```

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
| `FRONTEND_URL` | Public Telegram Mini App URL |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for Mini App auth and bot entry points |
| `TELEGRAM_AUTH_MAX_AGE_SECONDS` | Max accepted Telegram WebApp auth age |
| `ROUND_DURATION_SECONDS` | Jackpot round duration |
| `GAME_RAKE_BPS` | Game rake in basis points |
| `MIN_BET_NANOTONS` | Minimum bet amount in nanotons |
| `DEV_BOOTSTRAP_BALANCE_NANOTONS` | Local development bootstrap balance |
| `APP_WALLET_ADDRESS` | TON wallet watched for deposits |
| `APP_WALLET_MNEMONIC` | Optional payout wallet mnemonic |
| `TONCENTER_BASE_URL` | TON Center JSON-RPC endpoint |
| `TONCENTER_API_KEY` | Optional TON Center API key |
| `WATCHER_*` | Deposit watcher polling, catch-up, lock, and recovery settings |
| `HTTP_RATE_LIMIT_*` | HTTP rate-limit settings |
| `SOCKET_*` | Socket.IO buffer and rate-limit settings |
| `CHAT_*` | Chat moderation, cooldown, history, and admin settings |

Frontend variables:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Backend API origin |
| `VITE_SOCKET_URL` | Socket.IO origin; falls back to API origin when omitted |

## Quality Gates

```bash
npm run check
```

`npm run check` runs backend type checking and a production frontend build.

## Docker

Run the backend and database:

```bash
docker compose --env-file .env up -d --build
```

Apply migrations inside the backend container:

```bash
docker compose --env-file .env exec backend npx prisma migrate deploy
```

The frontend builds into static assets and can be served by Nginx, CDN, or any static host.

## Deployment Helper

`deploy.sh` is an optional SSH helper. It expects explicit runtime configuration instead of hardcoded machine-specific values:

```bash
SERVER_IP=203.0.113.10 \
SSH_KEY="$HOME/.ssh/tonanza" \
PUBLIC_ORIGIN="https://tonanza.example" \
./deploy.sh
```

Production secrets belong in `.env` or a deployment platform secret store. `.env` files are ignored by git.
