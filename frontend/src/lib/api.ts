import type { ActiveGameResponse, PlaceBetResponse, ResolveResponse, UserSyncResponse } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const maybeError = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(maybeError.message || "Ошибка запроса");
  }

  return (await response.json()) as T;
};

export const getActiveGame = async (): Promise<ActiveGameResponse> => {
  const response = await fetch(`${API_BASE}/v1/games/active`);
  return readJson<ActiveGameResponse>(response);
};

export const syncUser = async (payload: {
  telegramId: string;
  walletAddress?: string;
}): Promise<UserSyncResponse> => {
  const response = await fetch(`${API_BASE}/v1/users/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return readJson<UserSyncResponse>(response);
};

export const placeBet = async (payload: {
  userId: string;
  amountNanotons: string;
}): Promise<PlaceBetResponse> => {
  const response = await fetch(`${API_BASE}/v1/bets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return readJson<PlaceBetResponse>(response);
};

export const resolveGame = async (gameId: string): Promise<ResolveResponse> => {
  const response = await fetch(`${API_BASE}/v1/games/${gameId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });

  return readJson<ResolveResponse>(response);
};

export const healthCheck = async () => {
  const response = await fetch(`${API_BASE}/health`);
  return readJson<{ ok: boolean }>(response);
};
