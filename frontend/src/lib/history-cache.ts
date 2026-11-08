import type { GameHistoryEntry } from "../components/GameHistoryModal";
import type { WinnerHistoryItem } from "../components/HistoryRibbon";
import { randomColorByUserId } from "./format";
import { parseSafeBigInt, sanitizeAvatarUrl, sanitizeDisplayName } from "./security";

const MAX_HISTORY = 30;
const MAX_WINNERS = 20;
const WINNERS_FROM_HISTORY = 10;

const fallbackId = () => `${Date.now()}-${Math.random()}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseArray(raw: string | null): any[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Failed to restore cached list", error);
    return [];
  }
}

/** Разбирает историю из localStorage: данные там считаются недоверенными. */
export function restoreGameHistory(raw: string | null): GameHistoryEntry[] {
  return parseArray(raw).slice(0, MAX_HISTORY).map((game) => ({
    gameId: typeof game?.gameId === "string" ? game.gameId : fallbackId(),
    players: Array.isArray(game?.players)
      ? game.players.map((player: any) => ({
          userId: typeof player?.userId === "string" ? player.userId : "0",
          name: sanitizeDisplayName(player?.name, "Unknown"),
          amountNanotons: parseSafeBigInt(player?.amountNanotons),
          color: randomColorByUserId(typeof player?.userId === "string" ? player.userId : "0"),
          avatarUrl: sanitizeAvatarUrl(player?.avatarUrl)
        }))
      : [],
    winnerId: typeof game?.winnerId === "string" ? game.winnerId : null,
    winnerName: sanitizeDisplayName(game?.winnerName, "Unknown"),
    totalPotNanotons: parseSafeBigInt(game?.totalPotNanotons),
    payoutNanotons: parseSafeBigInt(game?.payoutNanotons),
    timestamp: typeof game?.timestamp === "number" ? game.timestamp : Date.now()
  }));
}

export function restoreWinners(raw: string | null): WinnerHistoryItem[] {
  return parseArray(raw).slice(0, MAX_WINNERS).map((winner) => ({
    id: typeof winner?.id === "string" ? winner.id : fallbackId(),
    username: sanitizeDisplayName(winner?.username, "Unknown"),
    payoutNanotons: parseSafeBigInt(winner?.payoutNanotons),
    avatarUrl: sanitizeAvatarUrl(winner?.avatarUrl),
    timestamp: typeof winner?.timestamp === "number" ? winner.timestamp : Date.now()
  }));
}

export function winnersFromHistory(history: GameHistoryEntry[]): WinnerHistoryItem[] {
  return history.slice(0, WINNERS_FROM_HISTORY).map((game) => ({
    id: game.gameId,
    username: sanitizeDisplayName(game.winnerName, "Unknown"),
    payoutNanotons: game.payoutNanotons,
    timestamp: game.timestamp || Date.now()
  }));
}
