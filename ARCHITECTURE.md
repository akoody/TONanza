# Jackpot PvP Architecture (TON)

## Components

1. API + Realtime (`src/server.ts`)
- Fastify REST API for bets/rounds/fairness.
- Socket.io for live UI updates (`game:betPlaced`, `game:resolved`).

2. Core game logic (`src/game/game.service.ts`)
- `placeBet(userId, amountNanotons)`.
- `determineWinner(gameId, clientSeed)`.
- Round lifecycle and provably-fair proof generation.

3. Provably fair module (`src/game/provably-fair.ts`)
- Generates `serverSeed` and `serverSeedHash`.
- Computes deterministic winning ticket from combined seed entropy.

4. Deposit watcher (`src/wallet/wallet-watcher.service.ts`)
- Polls TON transactions for app wallet.
- Parses memo/comment (`uid:<id>`).
- Idempotent crediting using unique `tx_hash`.

5. Entropy provider (`src/wallet/ton-entropy.service.ts`)
- Pulls latest TON masterchain metadata for `clientSeed`.

6. Scheduler (`src/round/round.scheduler.ts`)
- Resolves expired rounds automatically.

7. Storage (`prisma/schema.prisma`)
- PostgreSQL-only, no floating money types.

## Money model

- Internal unit: nanotons (`bigint`) everywhere.
- 1 ticket = 1 nanotons of bet size.
- Commission: integer basis points (`5% = 500 / 10_000`).

## Security-critical invariants

1. No double-spend via parallel requests
- User row lock (`SELECT ... FOR UPDATE`) before balance mutation.
- Game row lock before ticket range assignment.

2. Idempotent deposits
- Unique `deposits.tx_hash` blocks duplicate credits.

3. Server-seed secrecy
- `serverSeedHash` is public pre-round.
- `serverSeed` is revealed only when round is resolved.

4. Input hardening
- Zod validates request payloads (positive integer strings).

## Round flow

1. Open round exists (`ensureOpenGameExists`).
2. User places bet:
- lock `games` + `users` rows,
- decrement balance,
- allocate ticket range,
- update pot and next ticket cursor.
3. Timer expires.
4. Scheduler fetches `clientSeed` from TON entropy.
5. Winner chosen deterministically.
6. Winner balance incremented atomically.
7. Round closed and proof available.
8. New open round is created.
