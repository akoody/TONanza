import type { GameHistoryEntry } from "../components/GameHistoryModal";
import type { WinnerHistoryItem } from "../components/HistoryRibbon";
import type { GameHistoryEntry as ApiGameHistoryEntry } from "./api";
import { randomColorByUserId } from "./format";
import { parseSafeBigInt, sanitizeAvatarUrl, sanitizeDisplayName } from "./security";
import type { ActiveGameResponse, LiveEvent, PlayerChance } from "../types";

/** Преобразование снимков раунда и истории из API в состояние интерфейса. */
export const sortByAmountDesc = (left: PlayerChance, right: PlayerChance) => {
  if (left.amountNanotons === right.amountNanotons) return 0;
  return left.amountNanotons > right.amountNanotons ? -1 : 1;
};

export const mapPlayersFromSnapshot = (rawPlayers: ActiveGameResponse["players"]): PlayerChance[] =>
  rawPlayers
    .map((entry) => ({
      userId: entry.userId,
      name: sanitizeDisplayName(entry.name, `Игрок #${entry.userId.slice(-4)}`),
      amountNanotons: parseSafeBigInt(entry.amountNanotons),
      color: randomColorByUserId(entry.userId),
      avatarUrl: sanitizeAvatarUrl(entry.avatarUrl)
    }))
    .filter((entry) => entry.amountNanotons > 0n)
    .sort(sortByAmountDesc);

export const resolveHistoryTimestamp = (resolvedAt: ApiGameHistoryEntry["resolvedAt"]): number => {
  const timestamp = resolvedAt ? new Date(resolvedAt).getTime() : NaN;
  return Number.isFinite(timestamp) ? timestamp : Date.now();
};

export const mapGameHistoryEntries = (history: ApiGameHistoryEntry[]): GameHistoryEntry[] =>
  history.map((entry) => ({
    ...entry,
    players: entry.players.map((player) => ({
      ...player,
      amountNanotons: parseSafeBigInt(player.amountNanotons),
      name: sanitizeDisplayName(player.name, `User #${player.userId.slice(-4)}`),
      avatarUrl: sanitizeAvatarUrl(player.avatarUrl),
      color: randomColorByUserId(player.userId)
    })),
    totalPotNanotons: parseSafeBigInt(entry.totalPotNanotons),
    payoutNanotons: parseSafeBigInt(entry.payoutNanotons),
    timestamp: resolveHistoryTimestamp(entry.resolvedAt),
    winnerName: sanitizeDisplayName(entry.winnerName, "Unknown")
  }));

export const mapWinnerHistoryItems = (history: ApiGameHistoryEntry[]): WinnerHistoryItem[] =>
  history.map((entry) => ({
    id: entry.gameId,
    username: sanitizeDisplayName(entry.winnerName, "Unknown"),
    payoutNanotons: parseSafeBigInt(entry.payoutNanotons),
    avatarUrl: sanitizeAvatarUrl(entry.winnerAvatarUrl),
    timestamp: resolveHistoryTimestamp(entry.resolvedAt)
  }));

export function mergeLatestById<T extends { timestamp: number }>(
  items: T[],
  getId: (item: T) => string,
  limit: number
): T[] {
  const merged = new Map<string, T>();

  for (const item of items) {
    const id = getId(item);
    if (!id) continue;

    const existing = merged.get(id);
    if (!existing || item.timestamp >= existing.timestamp) {
      merged.set(id, item);
    }
  }

  return [...merged.values()]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit);
}

export const buildBetEventsFromSnapshot = (
  bets: NonNullable<ActiveGameResponse["bets"]>,
  myId: string
): LiveEvent[] =>
  bets.map((bet, index) => {
    const createdAt = new Date(bet.createdAt).getTime();
    return {
      id: `initial-bet-${bet.betId}`,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now() - index,
      type: "bet",
      text: "",
      data: {
        userId: bet.userId,
        username: sanitizeDisplayName(bet.username, `Игрок #${bet.userId.slice(-4)}`),
        avatarUrl: sanitizeAvatarUrl(bet.avatarUrl),
        amountNanotons: parseSafeBigInt(bet.amountNanotons).toString(),
        isUser: bet.userId === myId
      }
    };
  });

export const createPlayersSignature = (rawPlayers: ActiveGameResponse["players"]): string =>
  rawPlayers
    .map((entry) => `${entry.userId}:${entry.amountNanotons}`)
    .sort()
    .join("|");

export const createBetsSignature = (bets: NonNullable<ActiveGameResponse["bets"]>): string =>
  bets
    .map((bet) => `${bet.betId}:${bet.userId}:${bet.amountNanotons}:${bet.createdAt}`)
    .join("|");

export const buildBetEventKey = (payload: {
  gameId?: string;
  betId?: string;
  userId: string;
  ticketStart: string;
  ticketEnd: string;
}): string => {
  if (payload.betId) return `${payload.gameId ?? "unknown"}:${payload.betId}`;
  return `${payload.gameId ?? "unknown"}:${payload.userId}:${payload.ticketStart}:${payload.ticketEnd}`;
};
