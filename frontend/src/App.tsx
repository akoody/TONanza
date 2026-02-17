import { Confetti } from "./components/Confetti";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import confetti from "canvas-confetti";
import { Skeleton } from "./components/ui/Skeleton";
import { BettingDock } from "./components/BettingDock";
import { GameHeader } from "./components/GameHeader";
import { BetList } from "./components/BetList";
import { Roulette, type RoulettePlayer } from "./components/Roulette";
import { HistoryRibbon, type WinnerHistoryItem } from "./components/HistoryRibbon";
import { GameHistoryModal, type GameHistoryEntry } from "./components/GameHistoryModal";
import { getActiveGame, healthCheck, placeBet, resolveGame, syncUser } from "./lib/api";
import { formatNanotonsCompact, randomColorByUserId } from "./lib/format";
import { getTelegramUserId, hapticNotificationSuccess, hapticSelectionChanged, initTelegram } from "./lib/telegram";
import type { LiveEvent, PlayerChance, ResolveResponse } from "./types";
import { Volume2, VolumeX, ShieldCheck } from "lucide-react";
import { ParticipantsList } from "./components/ParticipantsList";


const NANOTONS_PER_TON = 1_000_000_000n;
const DEFAULT_BALANCE = 40n * NANOTONS_PER_TON;
const ROUND_SECONDS = 40;

const resolveSocketBaseUrl = (): string | undefined => {
  const socketEnv = (import.meta.env.VITE_SOCKET_URL ?? "").trim();
  const apiEnv = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
  const candidate = socketEnv || apiEnv;

  if (candidate) {
    try {
      return new URL(candidate, window.location.origin).origin;
    } catch {
      return undefined;
    }
  }

  return import.meta.env.DEV ? "http://localhost:3000" : undefined;
};

const createEventId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
};

const randomDemoHash = () => {
  return Array.from({ length: 64 })
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
};

const TEST_BOT_POOL = [
  { telegramId: "90001001", localId: "bot-1", name: "Hydra" },
  { telegramId: "90001002", localId: "bot-2", name: "Kraken" },
  { telegramId: "90001003", localId: "bot-3", name: "Levi" },
  { telegramId: "90001004", localId: "bot-4", name: "Nautil" },
  { telegramId: "90001005", localId: "bot-5", name: "Abyss" }
];

const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

const pickRandomBots = () => {
  const count = randomInt(1, 3);
  return [...TEST_BOT_POOL].sort(() => Math.random() - 0.5).slice(0, count);
};

const sortByAmountDesc = (left: PlayerChance, right: PlayerChance) => {
  if (left.amountNanotons === right.amountNanotons) return 0;
  return left.amountNanotons > right.amountNanotons ? -1 : 1;
};

const RANDOM_MODULUS_256 = 1n << 256n;

const randomUint256 = (): bigint => {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const words = new Uint32Array(8);
    crypto.getRandomValues(words);
    let value = 0n;
    for (const word of words) {
      value = (value << 32n) | BigInt(word);
    }
    return value;
  }
  return BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
};

const pickWinningTicketInRange = (totalTickets: bigint): bigint => {
  if (totalTickets <= 0n) throw new Error("totalTickets must be > 0");
  if (totalTickets >= RANDOM_MODULUS_256) return (randomUint256() % totalTickets) + 1n;

  const limit = RANDOM_MODULUS_256 - (RANDOM_MODULUS_256 % totalTickets);
  let candidate = randomUint256();
  while (candidate >= limit) {
    candidate = randomUint256();
  }
  return (candidate % totalTickets) + 1n;
};

const buildBetEventKey = (payload: {
  gameId?: string;
  betId?: string;
  userId: string;
  ticketStart: string;
  ticketEnd: string;
}): string => {
  if (payload.betId) return `${payload.gameId ?? "unknown"}:${payload.betId}`;
  return `${payload.gameId ?? "unknown"}:${payload.userId}:${payload.ticketStart}:${payload.ticketEnd}`;
};

const createAvatarDataUrl = (name: string, color: string) => {
  const initials = name.slice(0, 2).toUpperCase();
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${color}" />
        <stop offset="100%" stop-color="#0f172a" />
      </linearGradient>
    </defs>
    <rect width="96" height="96" rx="48" fill="url(#g)" />
    <text x="48" y="56" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="32" font-weight="700">${initials}</text>
  </svg>
  `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export default function App() {
  const [userId, setUserId] = useState("1001001");
  const [serverUserId, setServerUserId] = useState<string | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [serverSeedHash, setServerSeedHash] = useState<string>(randomDemoHash());
  const [totalPotNanotons, setTotalPotNanotons] = useState<bigint>(0n);
  const [players, setPlayers] = useState<PlayerChance[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [winnerUserId, setWinnerUserId] = useState<string | null>(null);
  const [spinRoundKey, setSpinRoundKey] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(ROUND_SECONDS);
  const [roundEndsAtMs, setRoundEndsAtMs] = useState<number>(Date.now() + ROUND_SECONDS * 1000);
  const [isSubmittingBet, setIsSubmittingBet] = useState(false);
  const [isResolvingRound, setIsResolvingRound] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [countdownStarted, setCountdownStarted] = useState(false);
  const [localBalanceNanotons, setLocalBalanceNanotons] = useState<bigint>(DEFAULT_BALANCE);
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [winningAmount, setWinningAmount] = useState<string | null>(null);

  // New States for Long Scroll Layout
  const [recentWinners, setRecentWinners] = useState<WinnerHistoryItem[]>([]);
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [showFairness, setShowFairness] = useState(false);
  const [gameHistory, setGameHistory] = useState<GameHistoryEntry[]>([]);
  const [selectedHistoryGame, setSelectedHistoryGame] = useState<GameHistoryEntry | null>(null);

  const socketBaseUrl = useMemo(() => resolveSocketBaseUrl(), []);
  const socketRef = useRef<Socket | null>(null);
  const resolvedRoundRef = useRef<string | null>(null);
  const activeGameIdRef = useRef<string | null>(null);
  const participantIdsRef = useRef<Set<string>>(new Set());
  const botTimerIdsRef = useRef<number[]>([]);
  const processedBetKeysRef = useRef<Set<string>>(new Set());
  const processedResolveGameIdsRef = useRef<Set<string>>(new Set());
  const pendingRoundRefreshAfterSpinRef = useRef<string | null>(null);

  const roulettePlayers = useMemo<RoulettePlayer[]>(() => {
    if (players.length === 0 || totalPotNanotons <= 0n) return [];
    const totalByPlayers = players.reduce((acc, player) => acc + player.amountNanotons, 0n);
    if (totalByPlayers <= 0n) return [];

    return players.map((player) => {
      const chancePercent = Number((player.amountNanotons * 1000n) / totalByPlayers) / 10;
      const name = player.name || `Player #${player.userId.slice(-4)}`;
      return {
        id: player.userId,
        avatarUrl: createAvatarDataUrl(name, player.color),
        chancePercent,
        color: player.color,
        name
      };
    });
  }, [players, totalPotNanotons]);

  const pushEvent = useCallback((event: Omit<LiveEvent, "id" | "createdAt" | "text"> & { text?: string }) => {
    setEvents((prev) => [{
      id: createEventId(),
      createdAt: Date.now(),
      text: event.text || "",
      ...event
    }, ...prev].slice(0, 200));
  }, []);

  const clearBotTimers = useCallback(() => {
    for (const timerId of botTimerIdsRef.current) window.clearTimeout(timerId);
    botTimerIdsRef.current = [];
  }, []);

  const resetForNextRound = useCallback((nextRound: any) => {
    clearBotTimers();
    resolvedRoundRef.current = null;
    participantIdsRef.current = new Set();
    processedBetKeysRef.current = new Set();
    processedResolveGameIdsRef.current = new Set();
    pendingRoundRefreshAfterSpinRef.current = null;

    setActiveGameId(nextRound.gameId);
    setServerSeedHash(nextRound.seedHash);
    setPlayers([]);
    setTotalPotNanotons(0n);
    setWinnerUserId(null);
    setShowWinnerModal(false);
    setWinningAmount(null);
    setEvents([]); // Clear live activity from previous game
    setRoundEndsAtMs(nextRound.endsAt);
    setCountdownStarted(Boolean(nextRound.countdownStarted));
    setRemainingSeconds(
      nextRound.countdownStarted
        ? Math.max(0, Math.ceil((nextRound.endsAt - Date.now()) / 1000))
        : ROUND_SECONDS
    );
  }, [clearBotTimers]);

  const registerParticipant = useCallback((participantId: string) => {
    if (participantIdsRef.current.has(participantId)) return;
    participantIdsRef.current.add(participantId);
  }, []);

  const upsertPlayerBet = useCallback((id: string, amountNanotons: bigint, label?: string) => {
    setPlayers((prev) => {
      const existing = prev.find((entry) => entry.userId === id);
      if (existing) {
        return [...prev]
          .map((entry) =>
            entry.userId === id
              ? { ...entry, amountNanotons: entry.amountNanotons + amountNanotons }
              : entry
          )
          .sort(sortByAmountDesc);
      }
      return [...prev, {
        userId: id,
        name: label ?? (id === userId ? "Вы" : `Игрок #${id.slice(-4)}`),
        amountNanotons,
        color: randomColorByUserId(id)
      }].sort(sortByAmountDesc);
    });
  }, [userId]);

  const startDemoRound = useCallback((message?: string) => {
    resetForNextRound({
      gameId: `demo-${Date.now()}`,
      seedHash: randomDemoHash(),
      endsAt: Date.now() + ROUND_SECONDS * 1000,
      countdownStarted: false,
      participantCount: 0
    });
    if (message) pushEvent({ text: message, type: "info" });
    setEvents([]);
  }, [pushEvent, resetForNextRound]);

  const fetchActiveRound = useCallback(async () => {
    const active = await getActiveGame();
    const nextEndsAt = new Date(active.endsAt).getTime();
    const activePlayers = (Array.isArray(active.players) ? active.players : [])
      .map((entry) => ({
        userId: entry.userId,
        name: `Игрок #${entry.userId.slice(-4)}`,
        amountNanotons: BigInt(entry.amountNanotons),
        color: randomColorByUserId(entry.userId)
      }))
      .filter((entry) => entry.amountNanotons > 0n)
      .sort(sortByAmountDesc);

    const hydratedParticipantIds = new Set(activePlayers.map((entry) => entry.userId));

    clearBotTimers();
    resolvedRoundRef.current = null;
    participantIdsRef.current = hydratedParticipantIds;
    processedBetKeysRef.current = new Set();
    processedResolveGameIdsRef.current = new Set();
    pendingRoundRefreshAfterSpinRef.current = null;
    setActiveGameId(active.id);
    setServerSeedHash(active.serverSeedHash);
    setWinnerUserId(null);
    setCountdownStarted(active.countdownStarted);
    setRemainingSeconds(active.countdownStarted ? Math.max(0, Math.ceil((nextEndsAt - Date.now()) / 1000)) : ROUND_SECONDS);
    setRoundEndsAtMs(nextEndsAt);
    setTotalPotNanotons(BigInt(active.totalPotNanotons));
    setPlayers(activePlayers);
    setShowWinnerModal(false);
  }, [clearBotTimers]);

  const syncBackendUser = useCallback(async (telegramId: string) => {
    if (isDemoMode || !/^[1-9][0-9]*$/.test(telegramId)) return;
    const synced = await syncUser({ telegramId });
    setServerUserId(synced.id);
    setLocalBalanceNanotons(BigInt(synced.balanceNanotons));
  }, [isDemoMode]);

  const triggerTestBotsAfterUserBet = useCallback((roundId: string) => {
    const selectedBots = pickRandomBots();
    for (const [index, bot] of selectedBots.entries()) {
      const delayMs = randomInt(450, 1600) + index * 220;
      const timerId = window.setTimeout(() => {
        if (activeGameIdRef.current !== roundId) return;
        const amountNanotons = BigInt(randomInt(1, 3)) * NANOTONS_PER_TON;

        if (isDemoMode) {
          upsertPlayerBet(bot.localId, amountNanotons, bot.name);
          registerParticipant(bot.localId);
          setTotalPotNanotons((prev) => prev + amountNanotons);
          pushEvent({
            type: "bet",
            data: { username: bot.name, amountNanotons: amountNanotons.toString(), isUser: false }
          });
          if (!countdownStarted && participantIdsRef.current.size >= 2) {
            setCountdownStarted(true);
            setRoundEndsAtMs(Date.now() + ROUND_SECONDS * 1000);
          }
          return;
        }

        void (async () => {
          try {
            const syncedBot = await syncUser({ telegramId: bot.telegramId });
            await placeBet({ userId: syncedBot.id, amountNanotons: amountNanotons.toString() });
          } catch (e) {
            console.warn("[bot] error", e);
          }
        })();
      }, delayMs);
      botTimerIdsRef.current.push(timerId);
    }
  }, [countdownStarted, isDemoMode, pushEvent, registerParticipant, upsertPlayerBet]);

  const handleResolveResult = useCallback((resolved: ResolveResponse) => {
    if (processedResolveGameIdsRef.current.has(resolved.gameId)) return;
    processedResolveGameIdsRef.current.add(resolved.gameId);

    if (!resolved.winnerId) {
      pendingRoundRefreshAfterSpinRef.current = null;
      pushEvent({ text: "Нет ставок. Перезапуск.", type: "info" });
      setWinnerUserId(null);
      setTimeout(() => void fetchActiveRound(), 500);
      return;
    }

    // TIMING FIX: Store winner but don't update history/UI yet
    pendingRoundRefreshAfterSpinRef.current = resolved.gameId;
    setWinnerUserId(resolved.winnerId);
    setSpinRoundKey((prev) => prev + 1);
    setTotalPotNanotons(BigInt(resolved.totalPotNanotons));
    setWinningAmount(resolved.payoutNanotons);

    // Store winner data to add to history AFTER animation completes
    const winner = players.find(p => p.userId === resolved.winnerId);
    const winnerName = winner?.name || `#${resolved.winnerId.slice(-4)}`;
    const payout = BigInt(resolved.payoutNanotons);

    // Store this data for handleSpinFinished to use
    (window as any).__pendingWinnerData = {
      gameId: resolved.gameId,
      players: [...players],
      winnerId: resolved.winnerId,
      winnerName,
      totalPotNanotons: BigInt(resolved.totalPotNanotons),
      payoutNanotons: payout,
      avatarUrl: winner ? createAvatarDataUrl(winnerName, winner.color) : undefined,
      timestamp: Date.now()
    };

    pushEvent({
      type: "win",
      data: {
        username: winnerName,
        payoutNanotons: resolved.payoutNanotons,
        isUser: resolved.winnerId === userId || resolved.winnerId === serverUserId
      }
    });
  }, [pushEvent, players, userId, serverUserId]);

  const handleSpinFinished = useCallback(() => {
    hapticNotificationSuccess();

    // NOW update history and game data (after animation completes)
    const pendingData = (window as any).__pendingWinnerData;
    if (pendingData) {
      setRecentWinners(prev => [{
        id: pendingData.gameId,
        username: pendingData.winnerName,
        payoutNanotons: pendingData.payoutNanotons,
        avatarUrl: pendingData.avatarUrl,
        timestamp: pendingData.timestamp
      }, ...prev].slice(0, 10));

      setGameHistory(prev => [{
        gameId: pendingData.gameId,
        players: pendingData.players,
        winnerId: pendingData.winnerId,
        winnerName: pendingData.winnerName,
        totalPotNanotons: pendingData.totalPotNanotons,
        payoutNanotons: pendingData.payoutNanotons,
        timestamp: pendingData.timestamp
      }, ...prev].slice(0, 20));

      (window as any).__pendingWinnerData = null;
    }

    // Trigger Confetti
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 60 };
    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;
    const interval: any = setInterval(function () {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) return clearInterval(interval);
      const particleCount = 50 * (timeLeft / duration);
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);

    // Show Modal
    setShowWinnerModal(true);

    // Prepare next round
    if (pendingRoundRefreshAfterSpinRef.current) {
      setTimeout(() => {
        pendingRoundRefreshAfterSpinRef.current = null;
        void fetchActiveRound();
      }, 4000); // Wait for modal to be seen
    }
  }, [fetchActiveRound]);

  const resolveCurrentRound = useCallback(async () => {
    if (!activeGameId || resolvedRoundRef.current === activeGameId) return;
    resolvedRoundRef.current = activeGameId;

    if (isDemoMode) {
      if (players.length === 0) {
        startDemoRound();
        return;
      }
      // Demo logic (simplified for brevity, assume valid)
      let cursor = 1n;
      const ranges = players.map(p => {
        const start = cursor;
        const end = start + p.amountNanotons - 1n;
        cursor = end + 1n;
        return { userId: p.userId, start, end };
      });
      const total = cursor - 1n;
      const winTicket = pickWinningTicketInRange(total);
      const winner = ranges.find(r => r.start <= winTicket && r.end >= winTicket);

      if (winner) {
        const payout = (totalPotNanotons * 95n) / 100n;
        handleResolveResult({
          status: "FINISHED",
          gameId: activeGameId,
          winnerId: winner.userId,
          winningTicket: winTicket.toString(),
          payoutNanotons: payout.toString(),
          commissionNanotons: (totalPotNanotons - payout).toString(),
          totalPotNanotons: totalPotNanotons.toString(),
          proof: null
        });
      }
      return;
    }

    try {
      setIsResolvingRound(true);
      const res = await resolveGame(activeGameId);
      handleResolveResult(res);
    } catch (e) {
      resolvedRoundRef.current = null;
      console.error(e);
    } finally {
      setIsResolvingRound(false);
    }
  }, [activeGameId, handleResolveResult, isDemoMode, players, startDemoRound, totalPotNanotons]);

  useEffect(() => {
    initTelegram();
    const telegramId = getTelegramUserId();
    const savedUser = localStorage.getItem("tonanza_user_id");
    const resolvedUser = String(telegramId ?? savedUser ?? "1001001");
    setUserId(resolvedUser);
    localStorage.setItem("tonanza_user_id", resolvedUser);

    if (localStorage.getItem("tonanza_local_balance")) {
      setLocalBalanceNanotons(BigInt(localStorage.getItem("tonanza_local_balance")!));
    }

    // STATE PERSISTENCE: Restore history and game data
    const savedWinners = localStorage.getItem("tonanza_recent_winners");
    if (savedWinners) {
      try {
        const parsed = JSON.parse(savedWinners);
        setRecentWinners(parsed.map((w: any) => ({
          ...w,
          payoutNanotons: BigInt(w.payoutNanotons)
        })));
      } catch (e) {
        console.warn("Failed to restore winners", e);
      }
    }

    const savedHistory = localStorage.getItem("tonanza_game_history");
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        setGameHistory(parsed.map((g: any) => ({
          ...g,
          players: g.players.map((p: any) => ({ ...p, amountNanotons: BigInt(p.amountNanotons) })),
          totalPotNanotons: BigInt(g.totalPotNanotons),
          payoutNanotons: BigInt(g.payoutNanotons)
        })));
      } catch (e) {
        console.warn("Failed to restore history", e);
      }
    }

    void (async () => {
      try {
        await healthCheck();
        await syncBackendUser(resolvedUser);
        await fetchActiveRound();
        setIsDemoMode(false);
      } catch {
        setIsDemoMode(true);
        setServerUserId(null);
        startDemoRound("Симуляция запущена.");
      }
    })();
  }, [fetchActiveRound, startDemoRound, syncBackendUser]);

  useEffect(() => {
    localStorage.setItem("tonanza_local_balance", localBalanceNanotons.toString());
  }, [localBalanceNanotons]);

  // STATE PERSISTENCE: Save history and winners to localStorage
  useEffect(() => {
    const serialized = recentWinners.map(w => ({
      ...w,
      payoutNanotons: w.payoutNanotons.toString()
    }));
    localStorage.setItem("tonanza_recent_winners", JSON.stringify(serialized));
  }, [recentWinners]);

  useEffect(() => {
    const serialized = gameHistory.map(g => ({
      ...g,
      players: g.players.map(p => ({ ...p, amountNanotons: p.amountNanotons.toString() })),
      totalPotNanotons: g.totalPotNanotons.toString(),
      payoutNanotons: g.payoutNanotons.toString()
    }));
    localStorage.setItem("tonanza_game_history", JSON.stringify(serialized));
  }, [gameHistory]);

  useEffect(() => {
    activeGameIdRef.current = activeGameId;
  }, [activeGameId]);

  useEffect(() => () => clearBotTimers(), [clearBotTimers]);

  useEffect(() => {
    if (isDemoMode) {
      socketRef.current?.disconnect();
      return;
    }
    const socket = io(socketBaseUrl, { path: "/socket.io", transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("game:betPlaced", (payload) => {
      if (!activeGameIdRef.current || payload.gameId !== activeGameIdRef.current) return;
      const betKey = buildBetEventKey(payload);
      if (processedBetKeysRef.current.has(betKey)) return;
      processedBetKeysRef.current.add(betKey);

      const amount = BigInt(payload.amountNanotons);
      upsertPlayerBet(payload.userId, amount);
      setTotalPotNanotons(BigInt(payload.totalPotNanotons));
      setCountdownStarted(payload.countdownStarted);
      setRoundEndsAtMs(new Date(payload.endsAt).getTime());

      pushEvent({
        type: "bet",
        data: {
          username: `Игрок #${payload.userId.slice(-4)}`,
          amountNanotons: payload.amountNanotons,
          isUser: payload.userId === userId || payload.userId === serverUserId
        }
      });
    });

    socket.on("game:resolved", handleResolveResult);
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [handleResolveResult, isDemoMode, pushEvent, socketBaseUrl, upsertPlayerBet, userId, serverUserId]);

  useEffect(() => {
    if (!countdownStarted) {
      setRemainingSeconds(ROUND_SECONDS);
      return;
    }
    const interval = setInterval(() => {
      const sec = Math.max(0, Math.ceil((roundEndsAtMs - Date.now()) / 1000));
      setRemainingSeconds(prev => {
        if (sec !== prev && sec > 0) hapticSelectionChanged();
        return sec;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [countdownStarted, roundEndsAtMs]);

  useEffect(() => {
    if (countdownStarted && remainingSeconds <= 0) void resolveCurrentRound();
  }, [countdownStarted, remainingSeconds, resolveCurrentRound]);

  const placeBetAction = async (amount: bigint) => {
    if (!activeGameId) return;
    setIsSubmittingBet(true);
    try {
      if (isDemoMode) {
        upsertPlayerBet(userId, amount, "Вы");
        registerParticipant(userId);
        setTotalPotNanotons(prev => prev + amount);
        setLocalBalanceNanotons(prev => prev > amount ? prev - amount : 0n);
        pushEvent({
          text: `Вы поставили ${formatNanotonsCompact(amount)}`,
          type: "bet",
          data: { username: "Вы", amountNanotons: amount.toString(), isUser: true }
        });
        if (!countdownStarted && participantIdsRef.current.size >= 2) {
          setCountdownStarted(true);
          setRoundEndsAtMs(Date.now() + ROUND_SECONDS * 1000);
        }
        triggerTestBotsAfterUserBet(activeGameId);
        return;
      }

      const effectiveId = serverUserId ?? userId;
      const res = await placeBet({ userId: effectiveId, amountNanotons: amount.toString() });
      const betKey = buildBetEventKey({ ...res, userId: res.userId });

      if (!processedBetKeysRef.current.has(betKey)) {
        processedBetKeysRef.current.add(betKey);
        upsertPlayerBet(effectiveId, amount, "Вы");
        setTotalPotNanotons(BigInt(res.totalPotNanotons));
        setRoundEndsAtMs(new Date(res.endsAt).getTime());
        setCountdownStarted(res.countdownStarted);
        pushEvent({
          text: `Вы вошли с ${formatNanotonsCompact(amount)}`,
          type: "bet",
          data: { username: "Вы", amountNanotons: amount.toString(), isUser: true }
        });
      }
      setLocalBalanceNanotons(BigInt(res.userBalanceNanotons));
      triggerTestBotsAfterUserBet(activeGameId);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  const isLoading = !activeGameId;

  return (
    <div className="relative flex flex-col h-[100dvh] w-full bg-gradient-to-b from-teal-950 via-cyan-900 to-teal-950 overflow-hidden font-sans text-white">
      {/* Background with Noise/Grid */}
      <div className="fixed inset-0 bg-neon-grid bg-[length:30px_30px] opacity-20 pointer-events-none" />
      <div className="fixed top-0 left-0 w-full h-1/2 bg-gradient-to-b from-cyan-500/5 to-transparent pointer-events-none" />

      {/* A. HEADER (Fixed Top) */}
      <div className="fixed top-0 left-0 right-0 z-50 h-16 bg-teal-950/80 backdrop-blur-md border-b border-cyan-400/10 flex items-center justify-between px-4">
        {/* Left: Balance with Wallet Controls */}
        <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
          <div className="flex flex-col leading-none">
            <span className="text-[9px] text-white/40 uppercase font-bold">Баланс</span>
            <span className="text-sm font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 drop-shadow-[0_0_10px_rgba(251,191,36,0.4)]">
              {(Number(localBalanceNanotons) / 1e9).toFixed(2)}
            </span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => {
                hapticSelectionChanged();
                console.log("Deposit clicked");
              }}
              className="w-6 h-6 rounded bg-gradient-to-br from-emerald-500 to-teal-600 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center text-white font-bold text-xs"
              title="Депозит"
            >
              +
            </button>
            <button
              onClick={() => {
                hapticSelectionChanged();
                console.log("Withdraw clicked");
              }}
              className="w-6 h-6 rounded bg-gradient-to-br from-rose-500 to-orange-600 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center text-white font-bold text-xs"
              title="Вывод"
            >
              −
            </button>
          </div>
        </div>

        {/* Center: Enhanced TONanza Text */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <span className="font-black tracking-tight text-2xl relative">
            {/* Background glow layer */}
            <span className="absolute inset-0 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-400 to-cyan-500 blur-sm opacity-70">
              TON<span className="font-light">anza</span>
            </span>
            {/* Main text with gradient */}
            <span className="relative">
              <span
                className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-cyan-400 to-teal-400"
                style={{
                  textShadow: '0 0 20px rgba(34, 211, 238, 0.6), 0 0 40px rgba(6, 182, 212, 0.4)'
                }}
              >
                TON
              </span>
              <span
                className="font-light text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-300 to-amber-400"
                style={{
                  textShadow: '0 0 20px rgba(251, 191, 36, 0.6), 0 0 40px rgba(245, 158, 11, 0.4)'
                }}
              >
                anza
              </span>
            </span>
          </span>
        </div>

        {/* Right: Online Badge + Sound Toggle */}
        <div className="flex items-center gap-3">
          {/* Online Badge */}
          <div className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-full border border-white/5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse" />
            <span className="text-xs font-mono font-bold text-white/80">
              1,204
            </span>
          </div>

          {/* Sound Toggle */}
          <button
            onClick={() => {
              hapticSelectionChanged();
              setIsSoundEnabled(!isSoundEnabled);
            }}
            className="p-2 text-white/50 hover:text-white active:scale-95 transition-colors"
          >
            {isSoundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        </div>
      </div>

      {/* B. SCROLLABLE CONTENT AREA */}
      <div className="flex-1 overflow-y-auto pt-16 pb-32 z-0 no-scrollbar relative">
        {/* 1. History Ribbon */}
        <HistoryRibbon
          winners={recentWinners}
          onSelectGame={(gameId) => {
            const entry = gameHistory.find(g => g.gameId === gameId);
            if (entry) setSelectedHistoryGame(entry);
          }}
        />

        <div className="px-4 space-y-6 pt-4">
          {/* 2. Total Pot (Heartbeat) */}
          {isLoading ? (
            <div className="flex flex-col items-center space-y-4 py-6">
              <Skeleton className="h-16 w-48 rounded-2xl" />
              <Skeleton className="h-2 w-64 rounded-full" />
            </div>
          ) : (
            <GameHeader
              totalPotNanotons={totalPotNanotons}
              remainingSeconds={remainingSeconds}
              countdownStarted={countdownStarted}
              roundDuration={ROUND_SECONDS}
            />
          )}

          {/* 3. Roulette 3D */}
          {isLoading ? (
            <div className="w-full h-[180px] flex items-center justify-center">
              <Skeleton className="h-40 w-full rounded-xl opacity-20" />
            </div>
          ) : (
            <Roulette
              players={roulettePlayers}
              winnerId={winnerUserId}
              isSpinning={Boolean(winnerUserId) && spinRoundKey > 0}
              spinKey={spinRoundKey}
              onFinish={handleSpinFinished}
            />
          )}


          {/* 4. Participants & Chances (NEW) */}
          <ParticipantsList
            players={players}
            totalPotNanotons={totalPotNanotons}
          />

          {/* 5. Live Bets Feed (Growing List) */}
          <div>
            <BetList events={events} />
          </div>

          {/* 6. Provably Fair Footer */}
          <div className="mt-8 pt-6 pb-4 border-t border-cyan-400/10">
            <button
              onClick={() => {
                hapticSelectionChanged();
                setShowFairness(true);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-teal-900/20 hover:bg-teal-800/30 rounded-xl border border-cyan-400/20 transition-colors"
            >
              <ShieldCheck className="text-cyan-400" size={18} />
              <span className="text-sm font-bold text-cyan-300">Честная игра (Provably Fair)</span>
            </button>
            <p className="text-center text-xs text-cyan-400/60 mt-2 px-4">Проверьте честность каждого раунда</p>
          </div>
        </div>

        {/* Fairness Modal Overlay */}
        <AnimatePresence>
          {
            showFairness && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
                onClick={() => setShowFairness(false)}
              >
                <div className="bg-slate-900 border border-white/10 p-6 rounded-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
                  <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <ShieldCheck className="text-cyan-400" /> Честная игра
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-white/50 uppercase block mb-1">Хэш серверного сида</label>
                      <div className="bg-black/50 p-2 rounded text-xs font-mono break-all text-white/80 border border-white/5">
                        {serverSeedHash}
                      </div>
                    </div>
                    <p className="text-xs text-white/40 leading-relaxed">
                      Эта игра использует доказуемо честную систему. Серверный сид генерируется перед началом раунда и хэшируется. Вы можете проверить результат после окончания раунда.
                    </p>
                    <button
                      onClick={() => setShowFairness(false)}
                      className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-sm transition-colors"
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              </motion.div>
            )
          }
        </AnimatePresence >
      </div >

      {/* C. BETTING DOCK (Fixed Bottom) */}
      < BettingDock
        balanceNanotons={localBalanceNanotons}
        currentPotNanotons={totalPotNanotons}
        isSubmitting={isSubmittingBet}
        disabled={Boolean(winnerUserId) || isResolvingRound
        }
        onPlaceBet={placeBetAction}
      />

      {/* CONFETTI */}
      < Confetti active={showWinnerModal} duration={4000} />

      {/* WINNING MOMENT OVERLAY */}
      <AnimatePresence>
        {
          showWinnerModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
            >
              <motion.div
                initial={{ scale: 0.5, y: 50 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="relative w-full max-w-sm rounded-[2rem] border border-brand-gold bg-slate-900/90 p-8 text-center shadow-[0_0_50px_rgba(255,215,0,0.3)] overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-brand opacity-10" />

                <motion.div
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="text-6xl mb-4 drop-shadow-[0_0_15px_rgba(255,215,0,0.8)]"
                >
                  👑
                </motion.div>

                <h2 className="text-2xl font-black uppercase text-white mb-2 tracking-widest">Джекпот!</h2>

                <div className="text-sm font-bold text-white/60 mb-6 uppercase tracking-wide">
                  Победитель забирает всё
                </div>

                <div className="bg-white/5 rounded-xl p-4 border border-white/10 mb-6">
                  <div className="text-4xl font-black font-mono text-transparent bg-clip-text bg-gradient-gold drop-shadow-sm">
                    {winningAmount ? formatNanotonsCompact(BigInt(winningAmount)) : "---"}
                  </div>
                </div>

                <button
                  onClick={() => {
                    hapticSelectionChanged();
                    console.log("Claiming prize:", winningAmount);
                    // TODO: Implement actual prize claim logic
                    setShowWinnerModal(false);
                  }}
                  className="w-full py-4 rounded-xl bg-gradient-gold text-black font-black uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,215,0,0.4)]"
                >
                  Забрать выигрыш
                </button>
              </motion.div>
            </motion.div>
          )
        }
      </AnimatePresence >

      {/* GAME HISTORY MODAL */}
      < GameHistoryModal
        game={selectedHistoryGame}
        onClose={() => setSelectedHistoryGame(null)}
      />
    </div >
  );
}

