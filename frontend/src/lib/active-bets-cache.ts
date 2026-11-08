import type { LiveEvent } from "../types";
import { parseSafeBigInt, sanitizeAvatarUrl, sanitizeDisplayName } from "./security";

const ACTIVE_BETS_CACHE_KEY = "tonanza_active_bet_events_v1";

type PersistedActiveBetsSnapshot = {
  gameId: string;
  totalPotNanotons: string;
  savedAt: number;
  entries: Array<{
    id: string;
    createdAt: number;
    data: {
      userId?: string;
      username?: string;
      avatarUrl?: string;
      amountNanotons?: string;
      isUser?: boolean;
    };
  }>;
};

export const loadPersistedActiveBetEvents = (gameId: string, totalPotNanotons: string): LiveEvent[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(ACTIVE_BETS_CACHE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as PersistedActiveBetsSnapshot;
    if (!parsed || typeof parsed !== "object") return [];
    if (parsed.gameId !== gameId || parsed.totalPotNanotons !== totalPotNanotons) return [];
    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) return [];

    const restoredEvents: LiveEvent[] = [];
    for (const entry of parsed.entries) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.id !== "string" || entry.id.length === 0) continue;
      if (!Number.isFinite(entry.createdAt) || entry.createdAt <= 0) continue;

      const amount = parseSafeBigInt(entry.data?.amountNanotons);
      if (amount <= 0n) continue;

      const userId =
        typeof entry.data?.userId === "string" && entry.data.userId.length > 0
          ? entry.data.userId
          : undefined;

      const username = sanitizeDisplayName(
        entry.data?.username,
        userId ? `Игрок #${userId.slice(-4)}` : "Игрок"
      );

      restoredEvents.push({
        id: entry.id,
        createdAt: Math.trunc(entry.createdAt),
        type: "bet",
        text: "",
        data: {
          userId,
          username,
          avatarUrl: sanitizeAvatarUrl(entry.data?.avatarUrl),
          amountNanotons: amount.toString(),
          isUser: entry.data?.isUser === true
        }
      });
    }

    return restoredEvents;
  } catch {
    return [];
  }
};

export const persistActiveBetEvents = (gameId: string, totalPotNanotons: string, events: LiveEvent[]) => {
  if (typeof window === "undefined") return;

  const betEntries = events
    .filter((event) => event.type === "bet")
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      data: {
        userId: event.data?.userId,
        username: event.data?.username,
        avatarUrl: event.data?.avatarUrl,
        amountNanotons: event.data?.amountNanotons,
        isUser: event.data?.isUser === true
      }
    }))
    .filter((entry) => parseSafeBigInt(entry.data.amountNanotons) > 0n);

  if (betEntries.length === 0) {
    window.localStorage.removeItem(ACTIVE_BETS_CACHE_KEY);
    return;
  }

  const snapshot: PersistedActiveBetsSnapshot = {
    gameId,
    totalPotNanotons,
    savedAt: Date.now(),
    entries: betEntries
  };

  window.localStorage.setItem(ACTIVE_BETS_CACHE_KEY, JSON.stringify(snapshot));
};
