import type { FastifyInstance } from "fastify";
import type { Server as SocketIOServer } from "socket.io";
import { BotService } from "./bot/bot.service.js";
import { ChatService } from "./chat/chat.service.js";
import { env } from "./config/env.js";
import { GameService } from "./game/game.service.js";
import { prisma } from "./lib/prisma.js";
import { RoundScheduler } from "./round/round.scheduler.js";
import { PayoutService } from "./wallet/payout.service.js";
import { TonEntropyService } from "./wallet/ton-entropy.service.js";
import { WalletWatcherService } from "./wallet/wallet-watcher.service.js";

export function createServices(app: FastifyInstance, io: SocketIOServer) {
  const botService = new BotService();

  const gameService = new GameService(prisma, {
    roundDurationSeconds: env.ROUND_DURATION_SECONDS,
    rakeBps: env.GAME_RAKE_BPS,
    minBetNanotons: env.MIN_BET_NANOTONS,
    io,
    notifyPrizeClaimed: async ({ telegramId, gameId }) => {
      const result = await botService.sendGameWonMessage(telegramId, gameId);
      if (!result.sent) {
        app.log.warn({ telegramId: telegramId.toString(), gameId: gameId.toString(), reason: result.reason }, "Failed to send win notification");
      }
    }
  });

  const entropyService = new TonEntropyService(env.TONCENTER_BASE_URL, env.TONCENTER_API_KEY);

  const walletWatcher = new WalletWatcherService(prisma, {
    walletAddress: env.APP_WALLET_ADDRESS,
    toncenterBaseUrl: env.TONCENTER_BASE_URL,
    toncenterApiKey: env.TONCENTER_API_KEY,
    pollIntervalMs: env.WATCHER_POLL_INTERVAL_MS,
    pollBatchSize: env.WATCHER_POLL_BATCH_SIZE,
    pollMaxPages: env.WATCHER_POLL_MAX_PAGES,
    catchupMaxPages: env.WATCHER_CATCHUP_MAX_PAGES,
    lockTtlMs: env.WATCHER_LOCK_TTL_MS,
    recoverFailedLimit: env.WATCHER_RECOVER_FAILED_LIMIT,
    io,
    notifyDepositCredited: async ({ telegramId, amountNanotons }) => {
      const result = await botService.sendDepositCreditedMessage(telegramId, amountNanotons);
      if (!result.sent) {
        app.log.warn({ telegramId: telegramId.toString(), amountNanotons: amountNanotons.toString(), reason: result.reason }, "Failed to send deposit notification");
      }
    }
  });

  const roundScheduler = new RoundScheduler(prisma, gameService, entropyService);

  const payoutService = new PayoutService(prisma, {
    mnemonic: env.APP_WALLET_MNEMONIC || "",
    toncenterBaseUrl: env.TONCENTER_BASE_URL,
    toncenterApiKey: env.TONCENTER_API_KEY,
    io,
    notifyWithdrawalCompleted: async ({ telegramId, amountNanotons }) => {
      const result = await botService.sendWithdrawalCompletedMessage(telegramId, amountNanotons);
      if (!result.sent) {
        app.log.warn({ telegramId: telegramId.toString(), amountNanotons: amountNanotons.toString(), reason: result.reason }, "Failed to send withdrawal notification");
      }
    }
  });

  const chatService = new ChatService(io, prisma, {
    enabled: env.CHAT_ENABLED,
    cooldownMs: env.CHAT_COOLDOWN_MS,
    maxMessageLength: env.CHAT_MAX_MESSAGE_LENGTH,
    historyLimit: env.CHAT_HISTORY_LIMIT,
    bucketCapacity: env.CHAT_BUCKET_CAPACITY,
    bucketWindowMs: env.CHAT_BUCKET_WINDOW_MS,
    autoMuteMs: env.CHAT_AUTO_MUTE_MS,
    adminUserIds: env.CHAT_ADMIN_USER_IDS
  });

  return {
    botService,
    chatService,
    entropyService,
    gameService,
    payoutService,
    roundScheduler,
    walletWatcher
  };
}

export type Services = ReturnType<typeof createServices>;
