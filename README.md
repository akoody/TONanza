# Jackpot PvP (TON) - Secure Backend Skeleton

Backend for Telegram Mini App roulette-style jackpot game on TON.

## Stack

- Node.js + TypeScript + Fastify
- PostgreSQL + Prisma
- Real-time events via Socket.io
- TON integration via `tonweb`
- Frontend: React + Vite + Tailwind + Framer Motion + Telegram WebApp SDK (`frontend/`)

## Security guarantees implemented

1. Race-condition protection:
- `placeBet` and deposit crediting run inside SERIALIZABLE DB transactions.
- Critical rows are locked with `SELECT ... FOR UPDATE` (`users`, `games`).

2. Money precision:
- All money values are `BigInt` in nanotons (`1 TON = 1_000_000_000 nanotons`).
- No floating-point math in payout and commission logic.

3. Provably fair:
- Round starts with hidden `serverSeed` and published `serverSeedHash`.
- Winner ticket is computed after timer end from `sha256(serverSeed:clientSeed)`.
- `clientSeed` comes from TON masterchain data (with fallback), and round proof is returned.

4. Strict validation:
- API payloads are validated with Zod.
- Non-positive/invalid bet inputs are rejected.

5. Deposit idempotency:
- `deposits.tx_hash` is unique and used as idempotency key.
- Duplicate blockchain transaction cannot be credited twice.

## Data model (Prisma)

Tables in `prisma/schema.prisma`:
- `users`
- `deposits`
- `withdrawals`
- `games`
- `bets`

All balance/amount/pot/commission fields are `BigInt` nanotons.

## API (minimal)

- `GET /health`
- `GET /v1/games/active`
- `POST /v1/bets` body: `{ "userId": "...", "amountNanotons": "..." }`
- `POST /v1/users/sync` body: `{ "telegramId": "..." }`
- `POST /v1/games/:gameId/resolve` body: `{ "clientSeed": "optional" }`
- `GET /v1/games/:gameId/fairness`
- `POST /v1/watcher/poll`

## Socket events

- `game:betPlaced`
- `game:resolved`

## Quick start

1. Copy env:

```bash
cp .env.example .env
```

2. Start PostgreSQL (Docker):

```bash
docker compose up -d
```

3. Install dependencies:

```bash
npm install
```

4. Generate Prisma client and run migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

5. Run in dev:

```bash
npm run dev
```

6. Run frontend in another terminal:

```bash
npm run frontend:install
npm run frontend:dev
```

## Notes for Telegram Mini App frontend

Frontend (React + Telegram WebApp SDK) can subscribe to Socket.io events and use the API above for:
- showing active round + timer
- creating bets
- showing winner + fairness proof post-round

Frontend entrypoint and key files:
- `frontend/tailwind.config.ts`
- `frontend/src/components/GameWheel.tsx`
- `frontend/src/components/BettingControls.tsx`
- `frontend/src/App.tsx`

## Troubleshooting

- `P1001: Can't reach database server at localhost:5432`:
  - ensure PostgreSQL is running locally;
  - with Docker, first start Docker Desktop, then run:

```bash
docker compose up -d
npm run prisma:migrate
```

- `Wallet watcher poll failed ... Unexpected end of JSON input`:
  - set `TONCENTER_BASE_URL` to `https://toncenter.com/api/v2/jsonRPC`;
  - set a real `APP_WALLET_ADDRESS` (not `EQ...` placeholder).

- Bets fail with `User not found` / `Insufficient balance` in local dev:
  - frontend now calls `POST /v1/users/sync` to auto-create/sync user by Telegram ID;
  - for local testing, bootstrap balance is controlled by `DEV_BOOTSTRAP_BALANCE_NANOTONS`.
