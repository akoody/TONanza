-- Track whether game prize has already been claimed by the winner.
ALTER TABLE "games"
ADD COLUMN IF NOT EXISTS "prize_claimed_at" TIMESTAMP(3);

-- Prevent duplicate payouts for historical FINISHED games that were paid instantly in old logic.
UPDATE "games"
SET "prize_claimed_at" = COALESCE("prize_claimed_at", "resolved_at", CURRENT_TIMESTAMP)
WHERE "status" = 'FINISHED'
  AND "prize_claimed_at" IS NULL;
