# TONanza Frontend

Telegram Mini App client for Jackpot PvP.

## Run

```bash
npm install
npm run dev
```

Set backend URLs in env:

```bash
VITE_API_BASE_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
```

Notes:
- `VITE_SOCKET_URL` is used for Socket.io and avoids Vite WS proxy errors (`EPIPE`, `ECONNRESET`) in local dev.
- If `VITE_SOCKET_URL` is omitted, frontend falls back to `VITE_API_BASE_URL`.
