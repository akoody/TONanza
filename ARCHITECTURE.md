# Architecture

## Runtime Boundary

TONanza is split into two deployable parts:

- `src/server.ts` starts the Fastify API, registers CORS, uploads, static file serving, Socket.IO, and Telegram bot lifecycle hooks.
- `frontend/src/main.tsx` starts the Telegram Mini App client. The frontend talks to the backend over REST and subscribes to deal-scoped Socket.IO rooms.

The backend is the source of truth for authentication, permissions, deal state, message history, and uploaded image paths. The frontend is a thin mobile client with optimistic-free state updates.

## Backend Flow

1. Every API request resolves the viewer through `resolveTelegramAuth`.
2. `DealService.upsertUser` syncs Telegram profile fields and admin status.
3. Deal operations validate input with Zod schemas before touching persistence.
4. Prisma writes the canonical state to PostgreSQL.
5. Mutating deal operations emit a `deal:update` event to `deal:{code}` Socket.IO room.

This keeps realtime delivery disposable: if a socket event is missed, the client can reload the deal by code and get the full canonical state.

## Data Model

The active Prisma model is intentionally small:

- `User` mirrors Telegram identity and admin status.
- `Deal` stores title, terms, amount, owner role, status, and close timestamp.
- `DealParticipant` links users to deals with owner/member/admin roles.
- `ChatMessage` stores text, photos, system events, requisites, and admin notifications.

BigInt IDs are serialized to strings before crossing the API boundary.

## Security Notes

- Telegram WebApp signatures are validated server-side with the bot token.
- Development auth bypass is disabled in production.
- CORS is origin-checked against configured frontend origins.
- Admin capabilities are based on `ADMIN_TELEGRAM_IDS`, not frontend state.
- Uploaded files are limited by MIME prefix, extension allow-list, count, and size.

## Build Surface

The repository still contains historical modules from earlier product experiments. The production TypeScript build is scoped to `src/server.ts`, which pulls in the currently wired runtime dependencies. This keeps the release path strict without pretending unrelated experimental code is part of the active backend.
