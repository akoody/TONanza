-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DealRole" AS ENUM ('BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WAITING_PAYMENT', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "DealParticipantRole" AS ENUM ('OWNER', 'MEMBER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ChatMessageKind" AS ENUM ('TEXT', 'PHOTO', 'SYSTEM', 'REQUISITES', 'NOTIFICATION');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" VARCHAR(64),
    "first_name" VARCHAR(128),
    "last_name" VARCHAR(128),
    "avatar_url" VARCHAR(512),
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "terms" VARCHAR(2000) NOT NULL,
    "owner_role" "DealRole" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "owner_id" BIGINT NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_participants" (
    "id" BIGSERIAL NOT NULL,
    "deal_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "role" "DealParticipantRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" BIGSERIAL NOT NULL,
    "deal_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "kind" "ChatMessageKind" NOT NULL DEFAULT 'TEXT',
    "text" VARCHAR(2000),
    "photo_url" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_code_key" ON "deals"("code");

-- CreateIndex
CREATE INDEX "deals_title_idx" ON "deals"("title");

-- CreateIndex
CREATE INDEX "deals_status_created_at_idx" ON "deals"("status", "created_at");

-- CreateIndex
CREATE INDEX "deal_participants_user_id_idx" ON "deal_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_participants_deal_id_user_id_key" ON "deal_participants"("deal_id", "user_id");

-- CreateIndex
CREATE INDEX "chat_messages_deal_id_created_at_idx" ON "chat_messages"("deal_id", "created_at");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_participants" ADD CONSTRAINT "deal_participants_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_participants" ADD CONSTRAINT "deal_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
