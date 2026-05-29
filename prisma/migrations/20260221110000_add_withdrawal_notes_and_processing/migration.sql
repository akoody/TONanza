-- Ensure enum value used by payout flow exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE lower(t.typname) = 'withdrawalstatus'
          AND e.enumlabel = 'PROCESSING'
    ) THEN
        ALTER TYPE "WithdrawalStatus" ADD VALUE 'PROCESSING';
    END IF;
END
$$;

-- Prisma schema has Withdrawal.notes, but legacy DBs may miss this column.
ALTER TABLE "withdrawals"
ADD COLUMN IF NOT EXISTS "notes" VARCHAR(255);
