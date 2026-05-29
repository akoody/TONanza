export type PlayerChance = {
  userId: string;
  name: string;
  amountNanotons: bigint;
  color: string;
  avatarUrl?: string;
};

export type ActiveGameResponse = {
  id: string;
  serverSeedHash: string;
  status: "OPEN" | "LOCKED" | "FINISHED" | "CANCELLED";
  totalPotNanotons: string;
  nextTicket: string;
  participantCount: number;
  countdownStarted: boolean;
  players: Array<{
    userId: string;
    amountNanotons: string;
    name: string;
    avatarUrl?: string;
    color: string;
  }>;
  bets?: Array<{
    betId: string;
    userId: string;
    amountNanotons: string;
    createdAt: string;
    username: string;
    avatarUrl?: string;
  }>;
  startsAt: string;
  endsAt: string;
};

export type PlaceBetResponse = {
  betId: string;
  userId: string;
  gameId: string;
  amountNanotons: string;
  ticketStart: string;
  ticketEnd: string;
  totalPotNanotons: string;
  userBalanceNanotons: string;
  participantCount: number;
  countdownStarted: boolean;
  endsAt: string;
  username?: string;
  avatarUrl?: string;
};

export type CancelBetResponse = {
  cancelledBetId: string;
  userId: string;
  gameId: string;
  refundedNanotons: string;
  totalPotNanotons: string;
  userBalanceNanotons: string;
  participantCount: number;
  countdownStarted: boolean;
  endsAt: string;
};

export type ResolveResponse = {
  status: "FINISHED" | "CANCELLED";
  gameId: string;
  winnerId: string | null;
  winnerBetId?: string;
  winningTicket: string | null;
  payoutNanotons: string;
  commissionNanotons: string;
  totalPotNanotons: string;
  resolvedAt?: string | null;
  proof: {
    algorithm: string;
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
    totalTickets: string;
    winningTicket: string;
  } | null;
};

export type ClaimPrizeResponse = {
  gameId: string;
  alreadyClaimed: boolean;
  claimedAt: string;
  payoutNanotons: string;
  balanceNanotons: string;
};

export type UserSyncResponse = {
  id: string;
  telegramId: string;
  walletAddress: string | null;
  username?: string;
  avatarUrl?: string;
  balanceNanotons: string;
  settledPrizeNanotons?: string;
  settledPrizeGameIds?: string[];
};

export type LiveEvent = {
  id: string;
  text: string;
  createdAt: number;
  type?: "bet" | "win" | "info";
  data?: {
    userId?: string;
    username?: string;
    avatarUrl?: string;
    amountNanotons?: string;
    payoutNanotons?: string;
    isUser?: boolean;
  };
};

export type ChatMessage = {
  id: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  text: string;
  createdAt: number;
};

export type ChatSendAck =
  | {
      ok: true;
      message: ChatMessage;
      nextMessageAtMs: number;
    }
  | {
      ok: false;
      code: "UNAUTHORIZED" | "INVALID_PAYLOAD" | "EMPTY_MESSAGE" | "COOLDOWN" | "RATE_LIMIT" | "MUTED" | "STOPPED";
      error: string;
      retryAfterMs?: number;
      mutedUntilMs?: number;
    };

export type ChatHistoryAck =
  | {
      ok: true;
      messages: ChatMessage[];
    }
  | {
      ok: false;
      code: string;
      error: string;
    };

export type ChatDeleteAck =
  | {
      ok: true;
      messageId: string;
    }
  | {
      ok: false;
      code: string;
      error: string;
    };

export type ChatToggleAck =
  | {
      ok: true;
      sendingEnabled: boolean;
    }
  | {
      ok: false;
      code: string;
      error: string;
    };
