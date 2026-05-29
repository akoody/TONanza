#!/bin/bash
set -euo pipefail

# Configuration.
# Override these values from the shell or a CI secret store:
# SERVER_IP=... SSH_KEY=... PUBLIC_ORIGIN=... ./deploy.sh
SERVER_IP="${SERVER_IP:?Set SERVER_IP before running deploy.sh}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/tonanza}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:?Set PUBLIC_ORIGIN before running deploy.sh}"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

trap 'echo "Deploy failed. Check the error above and fix it before retrying."' ERR

echo "Deploying TONanza to $SERVER_IP..."

# 1. Sync files
rsync -avz \
  -e "ssh -i $SSH_KEY" \
  --exclude node_modules \
  --exclude frontend/node_modules \
  --exclude .git \
  --exclude dist \
  --exclude frontend/dist \
  --exclude .idea \
  --exclude .vscode \
  "$LOCAL_DIR/" \
  root@$SERVER_IP:$REMOTE_DIR

# Explicitly copy .env to ensure it's on the server
scp -i "$SSH_KEY" "$LOCAL_DIR/.env" "root@$SERVER_IP:$REMOTE_DIR/.env"

echo "Files uploaded."
echo "Rebuilding and restarting backend on server..."

# 2. Restart backend and run migrations
ssh -i "$SSH_KEY" "root@$SERVER_IP" "REMOTE_DIR='$REMOTE_DIR' bash -s" <<'EOF'
set -euo pipefail

cd "$REMOTE_DIR"

# Retry helper for transient network/registry failures.
retry_cmd() {
  local cmd="$1"
  local attempts="${2:-3}"
  local sleep_seconds="${3:-8}"
  local i
  for i in $(seq 1 "$attempts"); do
    if bash -lc "$cmd"; then
      return 0
    fi
    if [ "$i" -lt "$attempts" ]; then
      echo "[deploy] attempt $i/$attempts failed, retrying in ${sleep_seconds}s: $cmd"
      sleep "$sleep_seconds"
    fi
  done
  echo "[deploy] all retries failed: $cmd"
  return 1
}

docker compose --env-file .env config

# Warm image metadata to reduce Docker Hub TLS flakiness during build.
retry_cmd "docker pull node:20-alpine" 3 10

# Build/start services with retries for transient registry/network errors.
retry_cmd "docker compose --env-file .env up -d --build" 3 12

# Existing postgres volume may keep old password; align DB role password with current .env
docker compose --env-file .env exec -T postgres sh -lc '
set -e
if ! PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[deploy] Postgres credentials mismatch detected, syncing role password from .env..."
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE \"$POSTGRES_USER\" WITH PASSWORD '\''$POSTGRES_PASSWORD'\'';"
fi
'

docker compose --env-file .env exec -T backend npx prisma migrate deploy
EOF

echo "Backend updated and migrations applied."
echo "Building frontend on server..."

# 3. Build frontend and copy to Nginx
ssh -i "$SSH_KEY" "root@$SERVER_IP" "cd '$REMOTE_DIR' && npm --prefix frontend ci --legacy-peer-deps && VITE_API_BASE_URL='$PUBLIC_ORIGIN' VITE_SOCKET_URL='$PUBLIC_ORIGIN' npm --prefix frontend run build && mkdir -p /var/www/html/tonanza && cp -r frontend/dist/* /var/www/html/tonanza/"

echo "Done. Backend and frontend updated."
