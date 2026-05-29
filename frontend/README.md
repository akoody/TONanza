# TONanza Mini App

Telegram Mini App client for secure deal management.

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
- `VITE_SOCKET_URL` is used for Socket.IO and avoids Vite WS proxy errors (`EPIPE`, `ECONNRESET`) in local dev.
- If `VITE_SOCKET_URL` is omitted, frontend falls back to `VITE_API_BASE_URL`.
