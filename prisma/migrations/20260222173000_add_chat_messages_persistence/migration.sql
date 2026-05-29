-- Persist in-game chat messages so recent history survives backend restarts.
CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "avatar_url" VARCHAR(512),
    "text" VARCHAR(1024) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_messages_created_at_idx"
    ON "chat_messages"("created_at" DESC);
