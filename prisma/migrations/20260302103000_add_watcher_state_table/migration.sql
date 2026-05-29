CREATE TABLE IF NOT EXISTS "watcher_state" (
  "id" INTEGER PRIMARY KEY,
  "wallet_address" VARCHAR(128) NOT NULL,
  "last_seen_lt" BIGINT NOT NULL DEFAULT 0,
  "last_seen_hash" VARCHAR(128),
  "lock_owner" VARCHAR(128),
  "lock_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "watcher_state_wallet_address_key"
  ON "watcher_state"("wallet_address");

INSERT INTO "watcher_state" ("id", "wallet_address", "last_seen_lt")
VALUES (1, '', 0)
ON CONFLICT ("id") DO NOTHING;
