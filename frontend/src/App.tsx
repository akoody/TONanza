import { BootScreen } from "./components/BootScreen";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Confetti } from "./components/Confetti";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import confetti from "canvas-confetti";
import { Skeleton } from "./components/ui/Skeleton";
import { BettingDock } from "./components/BettingDock";
import { GameHeader } from "./components/GameHeader";
import { BetList } from "./components/BetList";
import { GameChat } from "./components/GameChat";
import { Roulette, type RoulettePlayer } from "./components/Roulette";
import type { WinnerHistoryItem } from "./components/HistoryRibbon";
import { GameHistoryModal, type GameHistoryEntry } from "./components/GameHistoryModal";
import { MenuModal } from "./components/MenuModal";
import { ReferralModal } from "./components/ReferralModal";
import { TermsOfUseModal } from "./components/TermsOfUseModal";
import { cancelBet, claimGamePrize, getActiveGame, getGameHistory, getPaymentHistory, healthCheck, placeBet, resolveGame, syncUser, type PaymentHistoryEntry } from "./lib/api";
import { formatNanotonsCompact, randomColorByUserId } from "./lib/format";
import { ensureTelegramFullscreen, getStartParam, getTelegramUserId, hapticNotificationSuccess, hapticSelectionChanged, initTelegram, isDesktopPlatform, isTWA, openTelegramUrl } from "./lib/telegram";
import type {
  LiveEvent,
  PlayerChance,
  ResolveResponse
} from "./types";
import { ShieldCheck } from "lucide-react";
import { ParticipantsList } from "./components/ParticipantsList";
import { useToast } from "./components/ui/Toast";
import { PaymentModal } from "./components/PaymentModal";
import { useTonWallet } from "@tonconnect/ui-react";
import WebApp from "@twa-dev/sdk";
import { AccessDenied } from "./components/AccessDenied";
import { AppHeader } from "./components/AppHeader";
import { FairnessModal } from "./components/FairnessModal";
import { WinnerModal } from "./components/WinnerModal";
import { useChat } from "./hooks/useChat";
import { CHAT_MAX_MESSAGE_LENGTH } from "./lib/chat-protocol";
import { loadPersistedActiveBetEvents, persistActiveBetEvents } from "./lib/active-bets-cache";
import { restoreGameHistory, restoreWinners, winnersFromHistory } from "./lib/history-cache";
import {
  buildBetEventKey,
  buildBetEventsFromSnapshot,
  createBetsSignature,
  createPlayersSignature,
  mapGameHistoryEntries,
  mapPlayersFromSnapshot,
  mapWinnerHistoryItems,
  mergeLatestById,
  sortByAmountDesc
} from "./lib/round-snapshot";
import { soundEngine } from "./lib/audio";
import { parseSafeBigInt, sanitizeAvatarUrl, sanitizeDisplayName } from "./lib/security";

const ROUND_SECONDS = 40;
const ROULETTE_SPIN_DURATION_MS = 14_000;
const MIN_SYNCED_SPIN_DURATION_MS = 800;
const AUTO_PRIZE_CLAIM_DELAY_MS = 200;
const AUTO_PRIZE_CLAIM_RETRY_DELAY_MS = 400;
const AUTO_PRIZE_CLAIM_MAX_ATTEMPTS = 12;
const MOBILE_CONTENT_TOP_GAP_PX = 113;
const MOBILE_CONTENT_PADDING_TOP = `calc(env(safe-area-inset-top, 0px) + ${MOBILE_CONTENT_TOP_GAP_PX}px)`;

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

const isTextInputElement = (element: Element | null): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName !== "INPUT") return false;
  const input = element as HTMLInputElement;
  return input.type !== "button" && input.type !== "checkbox" && input.type !== "radio";
};

const isInPaymentModal = (element: Element | null): boolean => {
  if (!(element instanceof Element)) return false;
  return Boolean(element.closest(".payment-modal-overlay"));
};

const createAvatarDataUrl = (name: string, color: string) => {
  const initialsSource = sanitizeDisplayName(name, "U").replace(/[^\\p{L}\\p{N}]/gu, "");
  const initials = (initialsSource.slice(0, 2).toUpperCase() || "U").slice(0, 2);
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
  const appAccessAllowed = isTWA() || import.meta.env.DEV;

  const [userId, setUserId] = useState("1001001");
  const [serverUserId, setServerUserId] = useState<string | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [serverSeedHash, setServerSeedHash] = useState<string>("");
  const [totalPotNanotons, setTotalPotNanotons] = useState<bigint>(0n);
  const [players, setPlayers] = useState<PlayerChance[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [winnerUserId, setWinnerUserId] = useState<string | null>(null);
  const [spinRoundKey, setSpinRoundKey] = useState(0);
  const [currentSpinDurationMs, setCurrentSpinDurationMs] = useState(ROULETTE_SPIN_DURATION_MS);
  const [currentSpinSeed, setCurrentSpinSeed] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(ROUND_SECONDS);
  const [roundEndsAtMs, setRoundEndsAtMs] = useState<number>(Date.now() + ROUND_SECONDS * 1000);
  const [isSubmittingBet, setIsSubmittingBet] = useState(false);
  const [isCancellingBet, setIsCancellingBet] = useState(false);
  const [isResolvingRound, setIsResolvingRound] = useState(false);
  const [countdownStarted, setCountdownStarted] = useState(false);
  const [localBalanceNanotons, setLocalBalanceNanotons] = useState<bigint>(0n);
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [winningAmount, setWinningAmount] = useState<string | null>(null);
  const [winningGameId, setWinningGameId] = useState<string | null>(null);
  const [isClaimingPrize, setIsClaimingPrize] = useState(false);
  const [isWinningPrizeCredited, setIsWinningPrizeCredited] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showBootScreen, setShowBootScreen] = useState(true);

  const [isDesktop, setIsDesktop] = useState(false);

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentModalMode, setPaymentModalMode] = useState<"deposit" | "withdraw">("deposit");
  const [isReferralModalOpen, setIsReferralModalOpen] = useState(false);

  const { toast } = useToast();

  // New States for Long Scroll Layout
  const [recentWinners, setRecentWinners] = useState<WinnerHistoryItem[]>([]);
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [isHapticsEnabled, setIsHapticsEnabled] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showFairness, setShowFairness] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [gameHistory, setGameHistory] = useState<GameHistoryEntry[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryEntry[]>([]);
  const [selectedHistoryGame, setSelectedHistoryGame] = useState<GameHistoryEntry | null>(null);
  const [onlineUsers, setOnlineUsers] = useState(1);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  const socketBaseUrl = useMemo(() => resolveSocketBaseUrl(), []);
  const socketRef = useRef<Socket | null>(null);
  const chat = useChat(socketRef);
  const { bindChatSocket, resetChatRole } = chat;
  const resolvedRoundRef = useRef<string | null>(null);
  const activeGameIdRef = useRef<string | null>(null);
  const processedBetKeysRef = useRef<Set<string>>(new Set());
  const processedResolveGameIdsRef = useRef<Set<string>>(new Set());
  const autoClaimedPrizeGamesRef = useRef<Set<string>>(new Set());
  const autoPrizeClaimTimeoutRef = useRef<number | null>(null);
  const pendingRoundRefreshAfterSpinRef = useRef<string | null>(null);
  const isSpinningRef = useRef(false);
  const sessionRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const roundEndsAtMsRef = useRef<number>(roundEndsAtMs);
  const lastPlayersSignatureRef = useRef<string>("");
  const lastBetsSignatureRef = useRef<string>("");

  const triggerSelectionHaptic = useCallback(() => {
    if (isHapticsEnabled) hapticSelectionChanged();
  }, [isHapticsEnabled]);

  const triggerSuccessHaptic = useCallback(() => {
    if (isHapticsEnabled) hapticNotificationSuccess();
  }, [isHapticsEnabled]);

  // TON Connect wallet — sync address to backend when it changes
  const tonWallet = useTonWallet();

  useEffect(() => {
    if (appAccessAllowed) return;
    document.getElementById("static-splash")?.remove();
  }, [appAccessAllowed]);

  useEffect(() => {
    if (!appAccessAllowed) return;
    const walletAddr = tonWallet?.account?.address;
    if (!walletAddr || !userId) return;
    void syncUser({ telegramId: userId, walletAddress: walletAddr }).then(synced => {
      setServerUserId(synced.id);
      setLocalBalanceNanotons(parseSafeBigInt(synced.balanceNanotons));
    }).catch(e => console.warn("[wallet-sync] failed", e));
  }, [appAccessAllowed, tonWallet, userId]);

  const roulettePlayers = useMemo<RoulettePlayer[]>(() => {
    if (players.length === 0) return [];
    const totalByPlayers = players.reduce((acc, player) => acc + player.amountNanotons, 0n);
    if (totalByPlayers <= 0n) return [];

    return players.map((player) => {
      const chancePercent = Number((player.amountNanotons * 1000n) / totalByPlayers) / 10;
      const name = sanitizeDisplayName(player.name, `Player #${player.userId.slice(-4)}`);
      const safeAvatarUrl = sanitizeAvatarUrl(player.avatarUrl);
      return {
        id: player.userId,
        avatarUrl: safeAvatarUrl || createAvatarDataUrl(name, player.color),
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

  const upsertBetEvent = useCallback((payload: {
    eventId: string;
    createdAt?: number;
    userId?: string;
    username?: string;
    avatarUrl?: string;
    amountNanotons: string;
    isUser: boolean;
    text?: string;
  }) => {
    const amount = parseSafeBigInt(payload.amountNanotons);
    if (amount <= 0n) return;

    const createdAt =
      typeof payload.createdAt === "number" && Number.isFinite(payload.createdAt) && payload.createdAt > 0
        ? Math.trunc(payload.createdAt)
        : Date.now();

    const username = sanitizeDisplayName(
      payload.username,
      payload.userId ? `Игрок #${payload.userId.slice(-4)}` : "Игрок"
    );

    const nextEvent: LiveEvent = {
      id: payload.eventId,
      createdAt,
      type: "bet",
      text: payload.text || "",
      data: {
        userId: payload.userId,
        username,
        avatarUrl: sanitizeAvatarUrl(payload.avatarUrl),
        amountNanotons: amount.toString(),
        isUser: payload.isUser
      }
    };

    setEvents((prev) => {
      const existingIndex = prev.findIndex((event) => event.id === payload.eventId);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = nextEvent;
        return updated;
      }
      return [nextEvent, ...prev].slice(0, 200);
    });
  }, []);

  const upsertPlayerBet = useCallback((id: string, amountNanotons: bigint, name?: string, avatarUrl?: string) => {
    const safeName = sanitizeDisplayName(name, `Игрок #${id.slice(-4)}`);
    const safeAvatarUrl = sanitizeAvatarUrl(avatarUrl);
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
        name: safeName,
        amountNanotons,
        color: randomColorByUserId(id),
        avatarUrl: safeAvatarUrl
      }].sort(sortByAmountDesc);
    });
  }, []);

  const fetchActiveRound = useCallback(async (currentUserId?: string) => {
    const active = await getActiveGame();
    const nextEndsAt = new Date(active.endsAt).getTime();
    const activePlayers = mapPlayersFromSnapshot(Array.isArray(active.players) ? active.players : []);
    resolvedRoundRef.current = null;
    processedBetKeysRef.current = new Set();
    processedResolveGameIdsRef.current = new Set();
    pendingRoundRefreshAfterSpinRef.current = null;
    setActiveGameId(active.id);
    setServerSeedHash(active.serverSeedHash);
    setWinnerUserId(null);
    setIsClaimingPrize(false);
    setCurrentSpinDurationMs(ROULETTE_SPIN_DURATION_MS);
    setCurrentSpinSeed(null);
    setCountdownStarted(active.countdownStarted);
    setRemainingSeconds(active.countdownStarted ? Math.max(0, Math.ceil((nextEndsAt - Date.now()) / 1000)) : ROUND_SECONDS);
    setRoundEndsAtMs(nextEndsAt);
    setTotalPotNanotons(parseSafeBigInt(active.totalPotNanotons));
    setPlayers(activePlayers);

    const myId = currentUserId ?? serverUserId ?? userId;
    const authoritativeBets = Array.isArray(active.bets) ? active.bets : null;
    const hasAuthoritativeBets = authoritativeBets !== null;
    const persistedBetEvents = hasAuthoritativeBets
      ? []
      : loadPersistedActiveBetEvents(active.id, active.totalPotNanotons);
    const initialEvents: LiveEvent[] = hasAuthoritativeBets
      ? buildBetEventsFromSnapshot(authoritativeBets, myId)
      : persistedBetEvents.length > 0
        ? persistedBetEvents
        : activePlayers.map((player, index) => ({
          id: `initial-player-${player.userId}-${index}`,
          createdAt: Date.now() - index,
          type: "bet",
          text: "",
          data: {
            userId: player.userId,
            username: player.name,
            avatarUrl: player.avatarUrl,
            amountNanotons: player.amountNanotons.toString(),
            isUser: player.userId === myId
          }
        }));
    setEvents(initialEvents);
    lastPlayersSignatureRef.current = createPlayersSignature(Array.isArray(active.players) ? active.players : []);
    lastBetsSignatureRef.current = hasAuthoritativeBets ? createBetsSignature(authoritativeBets) : "";
  }, [serverUserId, userId]);

  useEffect(() => {
    if (!activeGameId) return;
    persistActiveBetEvents(activeGameId, totalPotNanotons.toString(), events);
  }, [activeGameId, events, totalPotNanotons]);

  const syncBackendUser = useCallback(async (telegramId: string): Promise<string | null> => {
    if (!/^[1-9][0-9]*$/.test(telegramId)) return null;

    // Extract user data from Telegram WebApp
    const user = WebApp.initDataUnsafe?.user;
    const username = sanitizeDisplayName(
      user?.username || user?.first_name || `User ${telegramId.slice(-4)}`,
      `User ${telegramId.slice(-4)}`
    );
    const avatarUrl = sanitizeAvatarUrl(user?.photo_url);

    console.log("[App] Syncing user:", { telegramId, username, avatarUrl });

    try {
      const synced = await syncUser({
        telegramId,
        username,
        avatarUrl,
        startParam: getStartParam()
      });
      setServerUserId(synced.id);
      setLocalBalanceNanotons(parseSafeBigInt(synced.balanceNanotons));
      const settledPrizeNanotons = parseSafeBigInt(synced.settledPrizeNanotons);
      if (settledPrizeNanotons > 0n) {
        toast(`Выигрыш ${formatNanotonsCompact(settledPrizeNanotons)} зачислен автоматически`, "success", 4500);
      }
      return synced.id;
    } catch (e) {
      console.error("Failed to sync user:", e);
      return null;
    }
  }, [toast]);

  const fetchPayments = useCallback(async () => {
    try {
      const history = await getPaymentHistory(50);
      const sanitized = history.map((entry) => ({
        ...entry,
        amountNanotons: parseSafeBigInt(entry.amountNanotons).toString()
      }));
      setPaymentHistory(sanitized);
    } catch (e) {
      console.error("Failed to fetch payments history", e);
    }
  }, []);

  const fetchGameHistorySnapshot = useCallback(async () => {
    try {
      const history = await getGameHistory();
      const mappedHistory = mapGameHistoryEntries(history);
      const mappedWinners = mapWinnerHistoryItems(history);

      setGameHistory((prev) => mergeLatestById([...mappedHistory, ...prev], (entry) => entry.gameId, 20));
      setRecentWinners((prev) => mergeLatestById([...mappedWinners, ...prev], (entry) => entry.id, 10));
    } catch (e) {
      console.error("Failed to fetch history", e);
    }
  }, []);

  const clearAutoPrizeClaimTimeout = useCallback(() => {
    if (autoPrizeClaimTimeoutRef.current === null) return;
    window.clearTimeout(autoPrizeClaimTimeoutRef.current);
    autoPrizeClaimTimeoutRef.current = null;
  }, []);

  const resetTransientRoundUi = useCallback(() => {
    clearAutoPrizeClaimTimeout();
    resolvedRoundRef.current = null;
    processedBetKeysRef.current = new Set();
    processedResolveGameIdsRef.current = new Set();
    pendingRoundRefreshAfterSpinRef.current = null;
    isSpinningRef.current = false;
    lastPlayersSignatureRef.current = "";
    lastBetsSignatureRef.current = "";
    (window as any).__pendingWinnerData = null;

    setWinnerUserId(null);
    setCurrentSpinDurationMs(ROULETTE_SPIN_DURATION_MS);
    setCurrentSpinSeed(null);
    setShowWinnerModal(false);
    setWinningGameId(null);
    setWinningAmount(null);
    setIsClaimingPrize(false);
    setIsWinningPrizeCredited(false);
  }, [clearAutoPrizeClaimTimeout]);

  useEffect(() => () => {
    clearAutoPrizeClaimTimeout();
  }, [clearAutoPrizeClaimTimeout]);

  const refreshAuthoritativeState = useCallback(async (options?: {
    includePayments?: boolean;
    resetRoundUi?: boolean;
    includeHistory?: boolean;
  }) => {
    if (!appAccessAllowed) return;
    if (sessionRefreshPromiseRef.current) {
      return sessionRefreshPromiseRef.current;
    }

    const effectiveTelegramId = getTelegramUserId() ?? userId;
    if (!/^[1-9][0-9]*$/.test(effectiveTelegramId)) return;

    const refreshPromise = (async () => {
      if (options?.resetRoundUi) {
        resetTransientRoundUi();
      }

      const syncedUserId = await syncBackendUser(effectiveTelegramId);

      await Promise.all([
        fetchActiveRound(syncedUserId ?? undefined),
        options?.includeHistory === false ? Promise.resolve() : fetchGameHistorySnapshot(),
        options?.includePayments ? fetchPayments() : Promise.resolve()
      ]);
    })().finally(() => {
      sessionRefreshPromiseRef.current = null;
    });

    sessionRefreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [appAccessAllowed, fetchActiveRound, fetchGameHistorySnapshot, fetchPayments, resetTransientRoundUi, syncBackendUser, userId]);

  const restoreViewport = useCallback(() => {
    ensureTelegramFullscreen([0, 120, 320, 900]);
  }, []);

  const handleResolveResult = useCallback((resolved: ResolveResponse) => {
    const activeRoundId = activeGameIdRef.current;
    if (resolved.gameId !== activeRoundId && pendingRoundRefreshAfterSpinRef.current !== resolved.gameId) {
      return;
    }

    if (processedResolveGameIdsRef.current.has(resolved.gameId)) return;
    processedResolveGameIdsRef.current.add(resolved.gameId);

    if (!resolved.winnerId) {
      pendingRoundRefreshAfterSpinRef.current = null;
      pushEvent({ text: "Нет ставок. Перезапуск.", type: "info" });
      setWinnerUserId(null);
      setCurrentSpinDurationMs(ROULETTE_SPIN_DURATION_MS);
      setCurrentSpinSeed(null);
      isSpinningRef.current = false;
      setTimeout(() => void fetchActiveRound(), 500);
      return;
    }

    // TIMING FIX: Store winner but don't update history/UI yet
    pendingRoundRefreshAfterSpinRef.current = resolved.gameId;
    setRemainingSeconds(0); // Instantly zero out timer so it does not falsely count down during the spin
    setWinnerUserId(resolved.winnerId);
    const resolvedAtMsRaw = resolved.resolvedAt ? new Date(resolved.resolvedAt).getTime() : NaN;
    const resolvedAtMs = Number.isFinite(resolvedAtMsRaw) ? resolvedAtMsRaw : Date.now();
    const elapsedSinceResolveMs = Math.max(0, Date.now() - resolvedAtMs);
    setCurrentSpinDurationMs(
      Math.max(MIN_SYNCED_SPIN_DURATION_MS, ROULETTE_SPIN_DURATION_MS - elapsedSinceResolveMs)
    );
    setCurrentSpinSeed(
      `${resolved.gameId}:${resolved.winnerId}:${resolved.winningTicket ?? "0"}`
    );
    isSpinningRef.current = true;
    setSpinRoundKey((prev) => prev + 1);
    setTotalPotNanotons(parseSafeBigInt(resolved.totalPotNanotons));
    setWinningAmount(resolved.payoutNanotons);

    // Store winner data to add to history AFTER animation completes
    const winner = players.find(p => p.userId === resolved.winnerId);

    // Use the name/avatar we have in state, which now should be accurate from backend/bets
    const winnerName = sanitizeDisplayName(winner?.name, `#${resolved.winnerId.slice(-4)}`);
    const payout = parseSafeBigInt(resolved.payoutNanotons);

    // Store this data for handleSpinFinished to use
    (window as any).__pendingWinnerData = {
      gameId: resolved.gameId,
      players: [...players],
      winnerId: resolved.winnerId,
      winnerName,
      totalPotNanotons: parseSafeBigInt(resolved.totalPotNanotons),
      payoutNanotons: payout,
      avatarUrl: sanitizeAvatarUrl(winner?.avatarUrl),
      timestamp: Date.now(),
      isUser: resolved.winnerId === userId || resolved.winnerId === serverUserId
    };
  }, [players, pushEvent, userId, serverUserId]);

  const closeWinnerModal = useCallback(() => {
    clearAutoPrizeClaimTimeout();
    setShowWinnerModal(false);
    setWinningGameId(null);
    setWinningAmount(null);
    setIsWinningPrizeCredited(false);
  }, [clearAutoPrizeClaimTimeout]);

  const claimPrizeForGame = useCallback(async (
    gameId: string,
    options?: {
      closeModalOnSuccess?: boolean;
      suppressErrorToast?: boolean;
    }
  ) => {
    if (!gameId || isClaimingPrize) {
      return "skipped" as const;
    }

    if (autoClaimedPrizeGamesRef.current.has(gameId)) {
      setIsWinningPrizeCredited(true);
      if (options?.closeModalOnSuccess) {
        closeWinnerModal();
      }
      return "already-claimed" as const;
    }

    setIsClaimingPrize(true);
    autoClaimedPrizeGamesRef.current.add(gameId);

    try {
      const claimed = await claimGamePrize(gameId);
      setLocalBalanceNanotons(parseSafeBigInt(claimed.balanceNanotons));
      setIsWinningPrizeCredited(true);

      if (!claimed.alreadyClaimed) {
        toast("💰 Выигрыш зачислен!", "success");
      }

      if (options?.closeModalOnSuccess) {
        closeWinnerModal();
      }

      return claimed.alreadyClaimed ? "already-claimed" as const : "claimed" as const;
    } catch (err) {
      autoClaimedPrizeGamesRef.current.delete(gameId);

      const maybeError = err as Error & { status?: number };
      const isRetryable =
        maybeError.status === 409 &&
        maybeError.message === "Prize is not available until the roulette finishes";

      if (!isRetryable) {
        console.error("Prize claim failed", err);
        if (!options?.suppressErrorToast) {
          toast("Не удалось зачислить выигрыш. Попробуйте ещё раз.", "error");
        }
      }

      return isRetryable ? "retryable" as const : "failed" as const;
    } finally {
      setIsClaimingPrize(false);
    }
  }, [closeWinnerModal, isClaimingPrize, toast]);

  const scheduleAutomaticPrizeClaim = useCallback((gameId: string) => {
    const runAttempt = (attempt: number, delayMs: number) => {
      clearAutoPrizeClaimTimeout();
      autoPrizeClaimTimeoutRef.current = window.setTimeout(() => {
        autoPrizeClaimTimeoutRef.current = null;

        void claimPrizeForGame(gameId, { suppressErrorToast: true }).then((result) => {
          if (result === "retryable" && attempt + 1 < AUTO_PRIZE_CLAIM_MAX_ATTEMPTS) {
            runAttempt(attempt + 1, AUTO_PRIZE_CLAIM_RETRY_DELAY_MS);
            return;
          }

          if (result === "failed") {
            toast("Не удалось автоматически зачислить выигрыш. Кнопка ниже попробует ещё раз.", "error");
          }
        });
      }, delayMs);
    };

    runAttempt(0, AUTO_PRIZE_CLAIM_DELAY_MS);
  }, [claimPrizeForGame, clearAutoPrizeClaimTimeout, toast]);

  const handleSpinFinished = useCallback(() => {
    triggerSuccessHaptic();

    // NOW update history and game data (after animation completes)
    const pendingData = (window as any).__pendingWinnerData;
    isSpinningRef.current = false;

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

      pushEvent({
        type: "win",
        data: {
          username: pendingData.winnerName,
          avatarUrl: pendingData.avatarUrl,
          payoutNanotons: pendingData.payoutNanotons.toString(),
          isUser: pendingData.isUser
        }
      });

      const myId = serverUserId ?? userId;
      const isWinner = pendingData.winnerId === myId;
      const isParticipant = pendingData.players.some((p: any) => p.userId === myId);

      if (isWinner) {
        soundEngine.playWinSound();
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

        // Show winner UI and start auto-claim only after the spin fully finishes.
        setIsWinningPrizeCredited(false);
        setWinningAmount(pendingData.payoutNanotons.toString());
        setWinningGameId(pendingData.gameId);
        setShowWinnerModal(true);
        scheduleAutomaticPrizeClaim(pendingData.gameId);
      } else if (isParticipant) {
        toast("😢 Увы, в этот раз не повезло.", "info", 5000);
      } else {
        // Observer
        toast(`🏆 Победил ${pendingData.winnerName}!`, "success", 4000);
      }

      (window as any).__pendingWinnerData = null;
    }

    // IMMIDIATE RESET: Clear the board right away after spin
    if (pendingRoundRefreshAfterSpinRef.current) {
      pendingRoundRefreshAfterSpinRef.current = null;
      void fetchActiveRound();
    }
  }, [fetchActiveRound, pushEvent, scheduleAutomaticPrizeClaim, serverUserId, toast, triggerSuccessHaptic, userId]);

  const handleClaimPrize = useCallback(async () => {
    triggerSelectionHaptic();
    if (isClaimingPrize) return;

    if (!winningGameId) {
      closeWinnerModal();
      return;
    }

    if (isWinningPrizeCredited) {
      closeWinnerModal();
      return;
    }

    clearAutoPrizeClaimTimeout();
    const result = await claimPrizeForGame(winningGameId, { closeModalOnSuccess: true });
    if (result === "retryable") {
      scheduleAutomaticPrizeClaim(winningGameId);
      toast("Зачисление ещё синхронизируется. Попробуйте через мгновение.", "info", 2600);
    }
  }, [
    claimPrizeForGame,
    clearAutoPrizeClaimTimeout,
    closeWinnerModal,
    isClaimingPrize,
    isWinningPrizeCredited,
    scheduleAutomaticPrizeClaim,
    toast,
    triggerSelectionHaptic,
    winningGameId
  ]);

  const handleBetCancelled = useCallback((payload: any) => {
    if (!activeGameIdRef.current || payload.gameId !== activeGameIdRef.current) return;

    const isMyBet = payload.userId === (serverUserId ?? userId);
    void fetchActiveRound();
    if (isMyBet) setLocalBalanceNanotons(parseSafeBigInt(payload.userBalanceNanotons));

    setTotalPotNanotons(parseSafeBigInt(payload.totalPotNanotons));
    setRoundEndsAtMs(new Date(payload.endsAt).getTime());
    setCountdownStarted(payload.countdownStarted);
  }, [fetchActiveRound, serverUserId, userId]);

  const resolveCurrentRound = useCallback(async () => {
    if (!activeGameId || resolvedRoundRef.current === activeGameId) return;
    resolvedRoundRef.current = activeGameId;

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
  }, [activeGameId, handleResolveResult]);

  useEffect(() => {
    if (!appAccessAllowed) return;

    initTelegram();
    setIsDesktop(isDesktopPlatform());
    ensureTelegramFullscreen([0, 180, 520, 1200, 2200]);
    try {
      WebApp.enableClosingConfirmation();
    } catch (e) {
      console.warn("WebApp init failed", e);
    }

    // Check welcome screen status
    const seenWelcome = localStorage.getItem("tonanza_welcome_seen");
    if (!seenWelcome) {
      setShowWelcome(true);
    }

    const telegramId = getTelegramUserId();
    const savedUser = localStorage.getItem("tonanza_user_id");
    const candidateUser = String(telegramId ?? savedUser ?? "1001001");
    const resolvedUser = /^[1-9][0-9]*$/.test(candidateUser) ? candidateUser : "1001001";
    setUserId(resolvedUser);
    localStorage.setItem("tonanza_user_id", resolvedUser);

    // STATE PERSISTENCE: Restore history and game data
    setRecentWinners(restoreWinners(localStorage.getItem("tonanza_recent_winners")));
    setGameHistory(restoreGameHistory(localStorage.getItem("tonanza_game_history")));

    void (async () => {
      try {
        await healthCheck();
        const syncedUserId = await syncBackendUser(resolvedUser);
        await fetchActiveRound(syncedUserId ?? undefined);
        await fetchPayments();
      } catch (error) {
        setServerUserId(null);
        setLocalBalanceNanotons(0n);
        console.error("Failed to initialize app from backend", error);
        toast("Нет соединения с сервером. Проверьте backend/API URL.", "error", 6000);
      } finally {
      }
    })();
  }, [appAccessAllowed, fetchActiveRound, fetchPayments, syncBackendUser, toast]);

  useEffect(() => {
    if (!appAccessAllowed) return;

    const reenterFullscreen = () => {
      ensureTelegramFullscreen([0, 160, 520]);
    };

    const resyncVisibleState = () => {
      reenterFullscreen();
      void refreshAuthoritativeState({
        resetRoundUi: true,
        includePayments: false,
        includeHistory: true
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resyncVisibleState();
      }
    };

    window.addEventListener("focus", resyncVisibleState);
    window.addEventListener("pageshow", resyncVisibleState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pointerdown", reenterFullscreen, { once: true, capture: true });

    return () => {
      window.removeEventListener("focus", resyncVisibleState);
      window.removeEventListener("pageshow", resyncVisibleState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pointerdown", reenterFullscreen, true);
    };
  }, [appAccessAllowed, refreshAuthoritativeState]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null;
      if (isTextInputElement(target) && !isInPaymentModal(target)) {
        document.body.classList.add("input-focus-active");
      }
    };

    const onFocusOut = () => {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (!isTextInputElement(activeElement) || isInPaymentModal(activeElement)) {
          document.body.classList.remove("input-focus-active");
        }
      }, 0);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.body.classList.remove("input-focus-active");
    };
  }, []);

  useEffect(() => {
    const rawSettings = localStorage.getItem("tonanza_settings");
    if (!rawSettings) return;

    try {
      const parsed = JSON.parse(rawSettings) as {
        soundEnabled?: boolean;
        hapticsEnabled?: boolean;
      };
      if (typeof parsed.soundEnabled === "boolean") setIsSoundEnabled(parsed.soundEnabled);
      if (typeof parsed.hapticsEnabled === "boolean") setIsHapticsEnabled(parsed.hapticsEnabled);
    } catch (e) {
      console.warn("Failed to restore settings", e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("tonanza_settings", JSON.stringify({
      soundEnabled: isSoundEnabled,
      hapticsEnabled: isHapticsEnabled
    }));
  }, [isHapticsEnabled, isSoundEnabled]);



  // STATE PERSISTENCE: Save history and winners to localStorage
  useEffect(() => {
    const serialized = recentWinners.map(w => ({
      ...w,
      payoutNanotons: w.payoutNanotons.toString()
    }));
    localStorage.setItem("tonanza_recent_winners", JSON.stringify(serialized));
  }, [recentWinners]);

  // Initial History Fetch & Persistence
  useEffect(() => {
    // 1. Load from local first (fastest)
    const restoredHistory = restoreGameHistory(localStorage.getItem("tonanza_game_history"));
    if (restoredHistory.length > 0) {
      setGameHistory(restoredHistory);
      setRecentWinners(winnersFromHistory(restoredHistory));
    }

    // 2. Fetch from backend (authoritative)
    void fetchGameHistorySnapshot();
  }, [fetchGameHistorySnapshot]);

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

  useEffect(() => {
    roundEndsAtMsRef.current = roundEndsAtMs;
  }, [roundEndsAtMs]);

  useEffect(() => {
    soundEngine.setEnabled(isSoundEnabled);
  }, [isSoundEnabled]);

  useEffect(() => {
    if (!appAccessAllowed) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setIsSocketConnected(false);
      return;
    }

    const socket = io(socketBaseUrl, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: {
        initData: WebApp.initData || undefined,
        devBypass: import.meta.env.DEV && !WebApp.initData,
        devUserId: userId
      }
    });
    socketRef.current = socket;
    setIsSocketConnected(socket.connected);
    const refreshChat = bindChatSocket(socket);

    socket.on("game:state", (gameState) => {
      // Sync global state every second or so
      if (!gameState) return;

      // IGNORE state updates if we are in the middle of a spin animation
      // This prevents the "New Round" state (Pot 0) from clearing the roulette tape
      if (isSpinningRef.current) return;

      const snapshotPlayers = Array.isArray(gameState.players) ? gameState.players : [];
      const nextPlayersSignature = createPlayersSignature(snapshotPlayers);
      if (nextPlayersSignature !== lastPlayersSignatureRef.current) {
        setPlayers(mapPlayersFromSnapshot(snapshotPlayers));
        lastPlayersSignatureRef.current = nextPlayersSignature;
      }

      if (Array.isArray(gameState.bets)) {
        const nextBetsSignature = createBetsSignature(gameState.bets);
        if (nextBetsSignature !== lastBetsSignatureRef.current) {
          const myId = serverUserId ?? userId;
          setEvents(buildBetEventsFromSnapshot(gameState.bets, myId));
          lastBetsSignatureRef.current = nextBetsSignature;
        }
      } else if (lastBetsSignatureRef.current !== "") {
        lastBetsSignatureRef.current = "";
      }

      if (gameState.id !== activeGameIdRef.current) {
        // New game started?
        if (gameState.status === "OPEN") {
          resolvedRoundRef.current = null;
          processedBetKeysRef.current = new Set();
          processedResolveGameIdsRef.current = new Set();
          pendingRoundRefreshAfterSpinRef.current = null;
          setActiveGameId(gameState.id);
          setServerSeedHash(gameState.serverSeedHash);
          setTotalPotNanotons(parseSafeBigInt(gameState.totalPotNanotons));
          setCountdownStarted(gameState.countdownStarted);
          setRoundEndsAtMs(new Date(gameState.endsAt).getTime());
        }
      } else {
        // Update current game
        setTotalPotNanotons(parseSafeBigInt(gameState.totalPotNanotons));
        setCountdownStarted(gameState.countdownStarted);
        const endsAtLoc = new Date(gameState.endsAt).getTime();
        // Only update if drift is significant to avoid jitter
        if (Math.abs(endsAtLoc - roundEndsAtMsRef.current) > 2000) {
          setRoundEndsAtMs(endsAtLoc);
          roundEndsAtMsRef.current = endsAtLoc;
        }
      }
    });

    socket.on("game:betPlaced", (payload) => {
      if (!activeGameIdRef.current || payload.gameId !== activeGameIdRef.current) return;
      const betKey = buildBetEventKey(payload);
      if (processedBetKeysRef.current.has(betKey)) return;
      processedBetKeysRef.current.add(betKey);

      const amount = parseSafeBigInt(payload.amountNanotons);
      upsertPlayerBet(payload.userId, amount, payload.username, payload.avatarUrl);
      setTotalPotNanotons(parseSafeBigInt(payload.totalPotNanotons));
      setCountdownStarted(payload.countdownStarted);
      setRoundEndsAtMs(new Date(payload.endsAt).getTime());
      const createdAtMs = new Date(payload.createdAt).getTime();
      upsertBetEvent({
        eventId: payload.betId ? `initial-bet-${payload.betId}` : `live-bet-${betKey}`,
        createdAt: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
        userId: payload.userId,
        username: payload.username,
        avatarUrl: payload.avatarUrl,
        amountNanotons: payload.amountNanotons,
        isUser: payload.userId === userId || payload.userId === serverUserId
      });
    });

    socket.on("game:outcome", (payload) => {
      // This replaces game:resolved for the new flow
      handleResolveResult(payload);
    });

    socket.on("game:betCancelled", handleBetCancelled);

    socket.on("user:balance", (balance: string) => {
      console.log("[App] Balance update:", balance);
      setLocalBalanceNanotons(parseSafeBigInt(balance));
    });

    socket.on("connect", () => {
      setIsSocketConnected(true);
      refreshChat();
    });
    socket.on("disconnect", () => {
      setIsSocketConnected(false);
    });
    socket.on("game:resolved", handleResolveResult);
    socket.on("online_users", (count: number) => setOnlineUsers(count));
    refreshChat();
    return () => {
      socket.disconnect();
      socketRef.current = null;
      setIsSocketConnected(false);
      resetChatRole();
    };
  }, [appAccessAllowed, handleResolveResult, bindChatSocket, resetChatRole, socketBaseUrl, upsertPlayerBet, userId, serverUserId, handleBetCancelled, upsertBetEvent]);

  useEffect(() => {
    if (!countdownStarted) {
      setRemainingSeconds(ROUND_SECONDS);
      return;
    }
    const interval = setInterval(() => {
      const sec = Math.max(0, Math.ceil((roundEndsAtMs - Date.now()) / 1000));
      setRemainingSeconds(prev => {
        if (sec !== prev && sec > 0) triggerSelectionHaptic();
        return sec;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [countdownStarted, roundEndsAtMs, triggerSelectionHaptic]);

  useEffect(() => {
    if (countdownStarted && remainingSeconds <= 0) void resolveCurrentRound();
  }, [countdownStarted, remainingSeconds, resolveCurrentRound]);

  const effectiveUserId = serverUserId ?? userId;
  const canCancelSoloBet = useMemo(() => {
    if (!effectiveUserId) return false;
    if (players.length !== 1) return false;
    if (winnerUserId || isResolvingRound || isSubmittingBet || isCancellingBet) return false;
    return players[0].userId === effectiveUserId && players[0].amountNanotons > 0n;
  }, [effectiveUserId, isCancellingBet, isResolvingRound, isSubmittingBet, players, winnerUserId]);

  const placeBetAction = async (amount: bigint) => {
    if (!activeGameId) return;
    if (amount > localBalanceNanotons) {
      toast("Недостаточно средств на балансе", "error");
      soundEngine.playActionError();
      return;
    }
    setIsSubmittingBet(true);
    try {
      const res = await placeBet({ userId: effectiveUserId, amountNanotons: amount.toString() });
      const betKey = buildBetEventKey({ ...res, userId: res.userId });

      if (!processedBetKeysRef.current.has(betKey)) {
        processedBetKeysRef.current.add(betKey);

        // Use local info for immediate update
        const user = WebApp.initDataUnsafe?.user;
        const myName = sanitizeDisplayName(user?.username || user?.first_name, `User ${effectiveUserId.slice(-4)}`);
        const myAvatar = sanitizeAvatarUrl(user?.photo_url);

        upsertPlayerBet(effectiveUserId, amount, myName, myAvatar);
        setTotalPotNanotons(parseSafeBigInt(res.totalPotNanotons));
        setRoundEndsAtMs(new Date(res.endsAt).getTime());
        setCountdownStarted(res.countdownStarted);
        upsertBetEvent({
          eventId: `initial-bet-${res.betId}`,
          userId: effectiveUserId,
          username: myName,
          avatarUrl: myAvatar,
          amountNanotons: amount.toString(),
          isUser: true,
          text: `Вы вошли с ${formatNanotonsCompact(amount)}`
        });
      }
      setLocalBalanceNanotons(parseSafeBigInt(res.userBalanceNanotons));
      soundEngine.playBetPlaced();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось сделать ставку";
      if (/insufficient|недостаточно/i.test(message)) {
        toast("Недостаточно средств на балансе", "error");
      } else {
        toast(message, "error");
      }
      soundEngine.playActionError();
      console.error(e);
    } finally {
      setIsSubmittingBet(false);
    }
  };

  const cancelBetAction = async () => {
    if (!activeGameId) return;

    setIsCancellingBet(true);
    try {
      const res = await cancelBet({ userId: effectiveUserId });
      setLocalBalanceNanotons(parseSafeBigInt(res.userBalanceNanotons));
      await fetchActiveRound();
      toast("Ставка отменена", "success");
      soundEngine.playBetCancelled();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось отменить ставку";
      toast(message, "error");
      soundEngine.playActionError();
      console.error(e);
    } finally {
      setIsCancellingBet(false);
    }
  };

  const isLoading = !activeGameId;

  // Restrict access to Telegram environment (bypass in DEV mode)
  if (!appAccessAllowed) {
    return <AccessDenied />;
  }

  return (
    <div className="relative flex flex-col h-[100svh] w-full max-w-md mx-auto bg-gradient-to-b from-teal-950 via-cyan-900 to-teal-950 overflow-hidden font-sans text-white shadow-2xl">
      {showBootScreen && (
        <BootScreen onComplete={() => setShowBootScreen(false)} />
      )}

      <div className={showBootScreen ? "relative flex h-full min-h-0 flex-col opacity-0 pointer-events-none" : "relative flex h-full min-h-0 flex-col opacity-100 transition-opacity duration-50"}>
        {showWelcome && (
          <WelcomeScreen
            onComplete={() => {
              ensureTelegramFullscreen([0, 120, 420, 1000]);
              setShowWelcome(false);
              localStorage.setItem("tonanza_welcome_seen", "true");
            }}
          />
        )}

        {/* Background with Noise/Grid */}
        <div className="absolute inset-0 bg-neon-grid bg-[length:30px_30px] opacity-20 pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-cyan-500/5 to-transparent pointer-events-none" />

        <AppHeader
          isDesktop={isDesktop}
          balanceNanotons={localBalanceNanotons}
          onlineUsers={onlineUsers}
          onSelectionHaptic={triggerSelectionHaptic}
          onSuccessHaptic={triggerSuccessHaptic}
          onOpenPayment={(mode) => {
            setPaymentModalMode(mode);
            setIsPaymentModalOpen(true);
          }}
          onOpenMenu={() => setIsMenuOpen(true)}
        />

        {/* B. SCROLLABLE CONTENT AREA */}
        <div
          className={`flex-1 overflow-y-auto pb-32 z-0 no-scrollbar relative ${isDesktop ? "pt-[84px]" : ""}`}
          style={isDesktop ? undefined : { paddingTop: MOBILE_CONTENT_PADDING_TOP }}
        >
        <div className="px-4 space-y-6 pt-4 pb-10">
          {/* 1. Total Pot (Heartbeat) */}
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

          {/* 2. Roulette 3D */}
          {isLoading ? (
            <div className="w-full h-[136px] flex items-center justify-center">
              <Skeleton className="h-[120px] w-full rounded-2xl opacity-20" />
            </div>
          ) : (
            <Roulette
              players={roulettePlayers}
              winnerId={winnerUserId}
              isSpinning={Boolean(winnerUserId) && spinRoundKey > 0}
              spinKey={spinRoundKey}
              spinDurationMs={currentSpinDurationMs}
              spinSeed={currentSpinSeed}
              onFinish={handleSpinFinished}
            />
          )}

          {/* 3. Participants & Chances */}
          <ParticipantsList
            players={players}
            totalPotNanotons={totalPotNanotons}
            currentUserId={effectiveUserId}
          />

          {/* 4. Live Bets Feed */}
          <div>
            <BetList events={events} />
          </div>

          {/* 5. In-Game Chat */}
          <GameChat
            messages={chat.messages}
            currentUserId={effectiveUserId}
            isConnected={isSocketConnected}
            isSending={chat.isSending}
            isSendingEnabled={chat.isSendingEnabled}
            isAdmin={chat.isAdmin}
            isTogglingChat={chat.isToggling}
            cooldownMsLeft={chat.cooldownMsLeft}
            mutedMsLeft={chat.mutedMsLeft}
            maxMessageLength={CHAT_MAX_MESSAGE_LENGTH}
            onSend={chat.send}
            onDeleteMessage={chat.deleteMessage}
            onToggleChat={chat.toggleSending}
            onViewportRestore={restoreViewport}
          />

          {/* 6. Provably Fair Footer */}
          <div className="flex justify-center pb-8 opacity-50 hover:opacity-100 transition-opacity">
            <button
              onClick={() => {
                triggerSelectionHaptic();
                setShowFairness(true);
              }}
              className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-cyan-200/60 hover:text-cyan-200 transition-all duration-200 ease-out active:scale-[0.99]"
            >
              <ShieldCheck size={14} />
              <span>Provably Fair</span>
            </button>
          </div>
        </div>
      </div>

      <FairnessModal isOpen={showFairness} serverSeedHash={serverSeedHash} onClose={() => setShowFairness(false)} />

      {/* C. BETTING DOCK (Fixed Bottom) */}
      <div className="relative z-10 w-full">
        <BettingDock
          balanceNanotons={localBalanceNanotons}
          isSubmitting={isSubmittingBet}
          isCancelling={isCancellingBet}
          disabled={Boolean(winnerUserId) || isResolvingRound}
          canCancelBet={canCancelSoloBet}
          onPlaceBet={placeBetAction}
          onCancelBet={cancelBetAction}
        />
      </div>

      {/* CONFETTI */}
      <Confetti active={showWinnerModal} duration={4000} />

      {showWinnerModal && (
        <WinnerModal
          amountNanotons={winningAmount}
          isClaiming={isClaimingPrize}
          isCredited={isWinningPrizeCredited}
          onClaim={() => void handleClaimPrize()}
        />
      )}

      {/* GAME HISTORY MODAL */}
      <GameHistoryModal
        game={selectedHistoryGame}
        onClose={() => setSelectedHistoryGame(null)}
      />

      <MenuModal
        isOpen={isMenuOpen}
        history={gameHistory}
        payments={paymentHistory}
        isSoundEnabled={isSoundEnabled}
        isHapticsEnabled={isHapticsEnabled}
        onToggleSound={() => {
          triggerSelectionHaptic();
          if (isSoundEnabled) {
            soundEngine.playUiClick();
          }
          setIsSoundEnabled((prev) => !prev);
        }}
        onToggleHaptics={() => {
          triggerSelectionHaptic();
          soundEngine.playUiClick();
          setIsHapticsEnabled((prev) => !prev);
        }}
        onSelectGame={(game) => {
          triggerSelectionHaptic();
          soundEngine.playUiClick();
          setSelectedHistoryGame(game);
        }}
        onOpenReferrals={() => {
          triggerSelectionHaptic();
          soundEngine.playUiClick();
          setIsMenuOpen(false);
          window.setTimeout(() => {
            setIsReferralModalOpen(true);
          }, 170);
        }}
        onOpenTerms={() => {
          triggerSelectionHaptic();
          soundEngine.playUiClick();
          setIsMenuOpen(false);
          window.setTimeout(() => {
            setIsTermsModalOpen(true);
          }, 170);
        }}
        onOpenOfficialChannel={() => {
          triggerSelectionHaptic();
          soundEngine.playUiClick();
          setIsMenuOpen(false);
          window.setTimeout(() => {
            const opened = openTelegramUrl("https://t.me/TONanzaNFT");
            if (!opened) {
              toast("Не удалось открыть канал", "error");
            }
          }, 170);
        }}
        onClose={() => {
          triggerSelectionHaptic();
          soundEngine.playUiClick();
          setIsMenuOpen(false);
        }}
      />

      <TermsOfUseModal
        isOpen={isTermsModalOpen}
        onClose={() => {
          triggerSelectionHaptic();
          soundEngine.playUiClick();
          setIsTermsModalOpen(false);
        }}
      />

      {/* PAYMENT MODAL */}
      <PaymentModal
        mode={paymentModalMode}
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        serverUserId={serverUserId}
        balanceNanotons={localBalanceNanotons}
        onBalanceRefresh={async () => {
          const effectiveTelegramId = getTelegramUserId() ?? userId;
          await syncBackendUser(effectiveTelegramId);
          await fetchPayments();
        }}
      />

      {/* REFERRAL MODAL */}
      <ReferralModal
        isOpen={isReferralModalOpen}
        onClose={() => setIsReferralModalOpen(false)}
        telegramId={userId}
        onBalanceRefresh={async () => {
          const effectiveTelegramId = getTelegramUserId() ?? userId;
          await syncBackendUser(effectiveTelegramId);
        }}
      />
      </div>
    </div>
  );
}
