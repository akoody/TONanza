-- Колонки появились в schema.prisma без миграции. Миграция идемпотентна:
-- на базах, куда их внесли вручную (prisma db push), она ничего не меняет.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "referral_balance_nanotons" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "referrer_id" BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_referrer_id_fkey') THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_referrer_id_fkey"
      FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "watcher_state"
  ALTER COLUMN "id" SET DEFAULT 1,
  ALTER COLUMN "updated_at" DROP DEFAULT;
