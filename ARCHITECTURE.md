# Architecture

## Product Boundary

TONanza is a Telegram Mini App jackpot casino built around a mobile-first real-time game loop:

- The frontend renders the jackpot table, betting dock, roulette, player list, game history, chat, referrals, onboarding, and TON payment modals.
- The backend owns persistence, Telegram identity, game services, wallet services, chat moderation, and realtime delivery.
- Socket.IO is used for live state delivery so the UI can react immediately to bets, round transitions, chat messages, and balance-related updates.

## Core Domains

### Game

The `src/game` domain contains the jackpot service layer and provably-fair helpers. The game flow is designed around:

1. Opening an active round.
2. Accepting TON-denominated bets.
3. Tracking players, tickets, and pot size.
4. Resolving the round with deterministic seed-based winner selection.
5. Persisting round history for transparency and UI history views.

### Wallet

The `src/wallet` domain contains TON-specific infrastructure:

- deposit watcher logic,
- TON entropy helper,
- payout service foundations,
- idempotent transaction handling patterns.

Money-like values are represented as integer nanotons in game and wallet modules to avoid floating-point precision errors.

### Realtime

The realtime layer is responsible for pushing game state, user state, and chat events to Telegram Mini App clients. Socket.IO rooms keep high-frequency UI updates separate from normal REST operations.

### Telegram

Telegram integration covers:

- Mini App initialization,
- Telegram WebApp auth data validation,
- bot entry points,
- Telegram-native haptics and mobile UX behavior on the frontend.

### Chat and Moderation

The chat domain provides schemas, persistence, basic moderation hooks, rate-limit foundations, and UI components for the in-game chat panel.

## Frontend Structure

The frontend is built with React and Vite. The main product surface is composed from focused UI modules:

- `BettingDock` for TON bet placement controls,
- `Roulette` for winner reveal animation,
- `ParticipantsList` and `BetList` for live round visibility,
- `GameHeader` and `HistoryRibbon` for current and previous rounds,
- `PaymentModal` for TON deposit UX,
- `GameChat` for live player communication,
- `ReferralModal`, `MenuModal`, `WelcomeScreen`, and `TermsOfUseModal` for supporting product flows.

## Security Notes

- Telegram WebApp signatures should be validated server-side with the bot token.
- Development auth bypass must stay disabled in production.
- CORS is restricted to configured frontend origins.
- Admin capabilities are based on server-side Telegram IDs.
- File uploads and chat messages should remain bounded by size, MIME/type validation, and rate limits.
- TON deposits and payouts require idempotency keys and integer-only balance mutations.

## Operational Notes

The repository includes Docker, Compose, env examples, migration files, and deploy helper scripts so the project can be reviewed and deployed without machine-specific setup. Build and audit commands are documented in the README and should be run before every release.
