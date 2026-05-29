import type {
  ActiveGameResponse,
  ClaimPrizeResponse,
  CancelBetResponse,
  PlaceBetResponse,
  ResolveResponse,
  UserSyncResponse
} from "../types";
import WebApp from "@twa-dev/sdk";

export type GameHistoryEntry = {
  gameId: string;
  winnerId: string | null;
  winnerName: string;
  winnerAvatarUrl?: string | null;
  totalPotNanotons: string;
  payoutNanotons: string;
  resolvedAt: string | Date | null;
  players: {
    userId: string;
    amountNanotons: string;
    name?: string;
    avatarUrl?: string;
  }[];
};

export type ReferralInfoResponse = {
  referralsCount: number;
  tierPercentage: number;
  hasReferrer: boolean;
  selfBetRakebackMinPercentage: number;
  selfBetRakebackMaxPercentage: number;
  referredBy: {
    telegramId: string;
    username: string | null;
  } | null;
  referralBalanceNanotons: string;
};

export type ClaimReferralResponse = {
  balanceNanotons: string;
  referralBalanceNanotons: string;
};

export type PaymentHistoryEntry = {
  kind: "DEPOSIT" | "WITHDRAWAL";
  id: string;
  amountNanotons: string;
  status: string;
  txHash?: string | null;
  comment?: string | null;
  sourceAddress?: string | null;
  toAddress?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TelegramBootstrapChatResponse = {
  ok: boolean;
  sent: boolean;
  reason: string | null;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const getDevTelegramId = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem("tonanza_user_id");
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return undefined;
  return raw;
};

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const maybeError = await response.json().catch(() => ({ message: response.statusText }));
    const error = new Error(maybeError.message || "Ошибка запроса") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
};

/** Build standard auth headers for all authenticated requests */
const authHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (WebApp.initData) {
    headers["X-Telegram-Init-Data"] = WebApp.initData;
  } else if (import.meta.env.DEV) {
    // Dev bypass: attach special header so backend skips signature check
    headers["x-bypass-auth"] = "true";
    const devTelegramId = getDevTelegramId();
    if (devTelegramId) {
      headers["x-dev-user-id"] = devTelegramId;
    }
  }
  return headers;
};

export const getActiveGame = async (): Promise<ActiveGameResponse> => {
  const response = await fetch(`${API_BASE}/v1/games/active`);
  return readJson<ActiveGameResponse>(response);
};

export const getGameHistory = async (): Promise<GameHistoryEntry[]> => {
  const response = await fetch(`${API_BASE}/v1/games/history`);
  return readJson<GameHistoryEntry[]>(response);
};

export const getPaymentHistory = async (limit: number = 30): Promise<PaymentHistoryEntry[]> => {
  const response = await fetch(`${API_BASE}/v1/payments/history?limit=${encodeURIComponent(String(limit))}`, {
    headers: authHeaders()
  });
  return readJson<PaymentHistoryEntry[]>(response);
};

export const syncUser = async (payload: {
  telegramId: string;
  walletAddress?: string;
  username?: string;
  avatarUrl?: string;
  startParam?: string;
}): Promise<UserSyncResponse> => {
  const response = await fetch(`${API_BASE}/v1/users/sync`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  return readJson<UserSyncResponse>(response);
};

/** Poll current user balance — used after deposit to detect credit */
export const getMyBalance = async (): Promise<UserSyncResponse> => {
  const response = await fetch(`${API_BASE}/v1/users/me`, {
    headers: authHeaders()
  });
  return readJson<UserSyncResponse>(response);
};

export const placeBet = async (payload: {
  userId: string;
  amountNanotons: string;
}): Promise<PlaceBetResponse> => {
  const response = await fetch(`${API_BASE}/v1/bets`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  return readJson<PlaceBetResponse>(response);
};

export const cancelBet = async (payload: {
  userId: string;
}): Promise<CancelBetResponse> => {
  const response = await fetch(`${API_BASE}/v1/bets/cancel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  return readJson<CancelBetResponse>(response);
};

export const resolveGame = async (gameId: string): Promise<ResolveResponse> => {
  const response = await fetch(`${API_BASE}/v1/games/${gameId}/resolve`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  return readJson<ResolveResponse>(response);
};

export const claimGamePrize = async (gameId: string): Promise<ClaimPrizeResponse> => {
  const response = await fetch(`${API_BASE}/v1/games/${gameId}/claim`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  return readJson<ClaimPrizeResponse>(response);
};

export const healthCheck = async () => {
  const response = await fetch(`${API_BASE}/health`);
  return readJson<{ ok: boolean }>(response);
};

export type WithdrawalResponse = {
  id: string;
  status: string;
  amountNanotons: string;
  toAddress: string;
};

/** Request a withdrawal — backend uses the user's linked wallet as destination */
export const requestWithdrawal = async (amountNanotons: string): Promise<WithdrawalResponse> => {
  const response = await fetch(`${API_BASE}/v1/withdrawals`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ amountNanotons })
  });
  return readJson<WithdrawalResponse>(response);
};

export const getReferralInfo = async (): Promise<ReferralInfoResponse> => {
  const response = await fetch(`${API_BASE}/v1/referrals/info`, {
    headers: authHeaders()
  });
  return readJson<ReferralInfoResponse>(response);
};

export const claimReferralBalance = async (): Promise<ClaimReferralResponse> => {
  const response = await fetch(`${API_BASE}/v1/referrals/claim`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  return readJson<ClaimReferralResponse>(response);
};

export const bootstrapTelegramChat = async (): Promise<TelegramBootstrapChatResponse> => {
  const response = await fetch(`${API_BASE}/v1/telegram/bootstrap-chat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  return readJson<TelegramBootstrapChatResponse>(response);
};
