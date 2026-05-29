import { BootScreen } from "./components/BootScreen";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Confetti } from "./components/Confetti";
import { AnimatePresence, motion } from "framer-motion";
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
import { cancelBet, claimGamePrize, getActiveGame, getGameHistory, getPaymentHistory, healthCheck, placeBet, resolveGame, syncUser, type GameHistoryEntry as ApiGameHistoryEntry, type PaymentHistoryEntry } from "./lib/api";
import { formatNanotonsBalance, formatNanotonsCompact, randomColorByUserId } from "./lib/format";
import { ensureTelegramFullscreen, getStartParam, getTelegramUserId, hapticNotificationSuccess, hapticSelectionChanged, initTelegram, isDesktopPlatform, isTWA, openTelegramUrl } from "./lib/telegram";
import type {
  ActiveGameResponse,
  ChatDeleteAck,
  ChatHistoryAck,
  ChatMessage,
  ChatSendAck,
  ChatToggleAck,
  LiveEvent,
  PlayerChance,
  ResolveResponse
} from "./types";
import { ChevronDown, Copy, LogOut, Menu, ShieldCheck } from "lucide-react";
import { ParticipantsList } from "./components/ParticipantsList";
import { useToast } from "./components/ui/Toast";
import { PaymentModal } from "./components/PaymentModal";
import { TonConnectButton, useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import WebApp from "@twa-dev/sdk";
import { AccessDenied } from "./components/AccessDenied";
import { soundEngine } from "./lib/audio";
import { parseSafeBigInt, sanitizeAvatarUrl, sanitizeChatText, sanitizeDisplayName } from "./lib/security";

const ROUND_SECONDS = 40;
const ROULETTE_SPIN_DURATION_MS = 14_000;
const MIN_SYNCED_SPIN_DURATION_MS = 800;
const AUTO_PRIZE_CLAIM_DELAY_MS = 200;
const AUTO_PRIZE_CLAIM_RETRY_DELAY_MS = 400;
const AUTO_PRIZE_CLAIM_MAX_ATTEMPTS = 12;
const CHAT_HISTORY_LIMIT = 100;
const CHAT_MAX_MESSAGE_LENGTH = 160;
const DEFAULT_CHAT_COOLDOWN_MS = 10_000;
const ACTIVE_BETS_CACHE_KEY = "tonanza_active_bet_events_v1";
const MOBILE_HEADER_TOP_GAP_PX = 52;
const MOBILE_CONTENT_TOP_GAP_PX = 113;
const MOBILE_HEADER_PADDING_TOP = `calc(env(safe-area-inset-top, 0px) + ${MOBILE_HEADER_TOP_GAP_PX}px)`;
const MOBILE_CONTENT_PADDING_TOP = `calc(env(safe-area-inset-top, 0px) + ${MOBILE_CONTENT_TOP_GAP_PX}px)`;

const msToSeconds = (value: number) => Math.max(1, Math.ceil(value / 1000));

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

const loadPersistedActiveBetEvents = (gameId: string, totalPotNanotons: string): LiveEvent[] => {
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

const persistActiveBetEvents = (gameId: string, totalPotNanotons: string, events: LiveEvent[]) => {
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

const formatWalletAddressShort = (address: string) => {
  if (!address) return "";
  if (address.length <= 7) return address;
  return `${address.slice(0, 3)}...${address.slice(-4)}`;
};

const sortByAmountDesc = (left: PlayerChance, right: PlayerChance) => {
  if (left.amountNanotons === right.amountNanotons) return 0;
  return left.amountNanotons > right.amountNanotons ? -1 : 1;
};

const mapPlayersFromSnapshot = (rawPlayers: ActiveGameResponse["players"]): PlayerChance[] =>
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

const resolveHistoryTimestamp = (resolvedAt: ApiGameHistoryEntry["resolvedAt"]): number => {
  const timestamp = resolvedAt ? new Date(resolvedAt).getTime() : NaN;
  return Number.isFinite(timestamp) ? timestamp : Date.now();
};

const mapGameHistoryEntries = (history: ApiGameHistoryEntry[]): GameHistoryEntry[] =>
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

const mapWinnerHistoryItems = (history: ApiGameHistoryEntry[]): WinnerHistoryItem[] =>
  history.map((entry) => ({
    id: entry.gameId,
    username: sanitizeDisplayName(entry.winnerName, "Unknown"),
    payoutNanotons: parseSafeBigInt(entry.payoutNanotons),
    avatarUrl: sanitizeAvatarUrl(entry.winnerAvatarUrl),
    timestamp: resolveHistoryTimestamp(entry.resolvedAt)
  }));

function mergeLatestById<T extends { timestamp: number }>(
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

const buildBetEventsFromSnapshot = (
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

const createPlayersSignature = (rawPlayers: ActiveGameResponse["players"]): string =>
  rawPlayers
    .map((entry) => `${entry.userId}:${entry.amountNanotons}`)
    .sort()
    .join("|");

const createBetsSignature = (bets: NonNullable<ActiveGameResponse["bets"]>): string =>
  bets
    .map((bet) => `${bet.betId}:${bet.userId}:${bet.amountNanotons}:${bet.createdAt}`)
    .join("|");

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

const normalizeChatMessage = (payload: unknown): ChatMessage | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (typeof source.id !== "string" || source.id.length === 0 || source.id.length > 128) return null;
  if (typeof source.userId !== "string" || source.userId.length === 0 || source.userId.length > 128) return null;

  const createdAtRaw = source.createdAt;
  const createdAt =
    typeof createdAtRaw === "number"
      ? Math.trunc(createdAtRaw)
      : typeof createdAtRaw === "string" && /^\d{1,16}$/.test(createdAtRaw)
        ? Number(createdAtRaw)
        : NaN;

  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;

  const username = sanitizeDisplayName(source.username, `User #${source.userId.slice(-4)}`);
  const text = sanitizeChatText(source.text, CHAT_MAX_MESSAGE_LENGTH);
  if (!text) return null;

  return {
    id: source.id,
    userId: source.userId,
    username,
    avatarUrl: sanitizeAvatarUrl(source.avatarUrl),
    text,
    createdAt
  };
};

const normalizeChatSendAck = (payload: unknown): ChatSendAck | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (source.ok === true) {
    const message = normalizeChatMessage(source.message);
    if (!message) return null;
    if (typeof source.nextMessageAtMs !== "number" || !Number.isFinite(source.nextMessageAtMs)) return null;
    return {
      ok: true,
      message,
      nextMessageAtMs: Math.trunc(source.nextMessageAtMs)
    };
  }

  if (source.ok !== false || typeof source.error !== "string" || typeof source.code !== "string") {
    return null;
  }

  const knownCodes = [
    "UNAUTHORIZED",
    "INVALID_PAYLOAD",
    "EMPTY_MESSAGE",
    "COOLDOWN",
    "RATE_LIMIT",
    "MUTED",
    "STOPPED"
  ] as const;
  type KnownCode = (typeof knownCodes)[number];
  const code: KnownCode = (knownCodes as readonly string[]).includes(source.code)
    ? (source.code as KnownCode)
    : "INVALID_PAYLOAD";

  const retryAfterMs =
    typeof source.retryAfterMs === "number" && Number.isFinite(source.retryAfterMs) && source.retryAfterMs > 0
      ? Math.trunc(source.retryAfterMs)
      : undefined;
  const mutedUntilMs =
    typeof source.mutedUntilMs === "number" && Number.isFinite(source.mutedUntilMs) && source.mutedUntilMs > 0
      ? Math.trunc(source.mutedUntilMs)
      : undefined;

  return {
    ok: false,
    code,
    error: source.error,
    retryAfterMs,
    mutedUntilMs
  };
};

const normalizeChatHistoryAck = (payload: unknown): ChatHistoryAck | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (source.ok === true && Array.isArray(source.messages)) {
    const messages = source.messages
      .map((item) => normalizeChatMessage(item))
      .filter((item): item is ChatMessage => item !== null)
      .slice(-CHAT_HISTORY_LIMIT);
    return {
      ok: true,
      messages
    };
  }

  if (source.ok === false && typeof source.code === "string" && typeof source.error === "string") {
    return {
      ok: false,
      code: source.code,
      error: source.error
    };
  }

  return null;
};

const normalizeChatDeleteAck = (payload: unknown): ChatDeleteAck | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (source.ok === true && typeof source.messageId === "string") {
    return {
      ok: true,
      messageId: source.messageId
    };
  }

  if (source.ok === false && typeof source.code === "string" && typeof source.error === "string") {
    return {
      ok: false,
      code: source.code,
      error: source.error
    };
  }

  return null;
};

const normalizeChatToggleAck = (payload: unknown): ChatToggleAck | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  if (source.ok === true && typeof source.sendingEnabled === "boolean") {
    return {
      ok: true,
      sendingEnabled: source.sendingEnabled
    };
  }

  if (source.ok === false && typeof source.code === "string" && typeof source.error === "string") {
    return {
      ok: false,
      code: source.code,
      error: source.error
    };
  }

  return null;
};

const normalizeChatStatusPayload = (payload: unknown): { sendingEnabled: boolean } | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;
  if (typeof source.sendingEnabled !== "boolean") return null;
  return { sendingEnabled: source.sendingEnabled };
};

const normalizeChatRolePayload = (payload: unknown): { isAdmin: boolean } | null => {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;
  if (typeof source.isAdmin !== "boolean") return null;
  return { isAdmin: source.isAdmin };
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
  const [isWalletDropdownOpen, setIsWalletDropdownOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isTogglingChat, setIsTogglingChat] = useState(false);
  const [chatCooldownUntilMs, setChatCooldownUntilMs] = useState(0);
  const [chatMutedUntilMs, setChatMutedUntilMs] = useState(0);
  const [chatClockMs, setChatClockMs] = useState(Date.now());
  const [isChatAdmin, setIsChatAdmin] = useState(false);
  const [isChatSendingEnabled, setIsChatSendingEnabled] = useState(true);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  const socketBaseUrl = useMemo(() => resolveSocketBaseUrl(), []);
  const socketRef = useRef<Socket | null>(null);
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
  const walletDropdownRef = useRef<HTMLDivElement | null>(null);

  const triggerSelectionHaptic = useCallback(() => {
    if (isHapticsEnabled) hapticSelectionChanged();
  }, [isHapticsEnabled]);

  const triggerSuccessHaptic = useCallback(() => {
    if (isHapticsEnabled) hapticNotificationSuccess();
  }, [isHapticsEnabled]);

  // TON Connect wallet — sync address to backend when it changes
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const tonAddress = useTonAddress();
  const compactTonAddress = useMemo(() => formatWalletAddressShort(tonAddress), [tonAddress]);

  useEffect(() => {
    if (appAccessAllowed) return;
    document.getElementById("static-splash")?.remove();
  }, [appAccessAllowed]);

  useEffect(() => {
    if (!tonWallet) {
      setIsWalletDropdownOpen(false);
    }
  }, [tonWallet]);

  useEffect(() => {
    if (!isWalletDropdownOpen) return;

    const onPointerDownOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || walletDropdownRef.current?.contains(target)) return;
      setIsWalletDropdownOpen(false);
    };

    document.addEventListener("mousedown", onPointerDownOutside);
    document.addEventListener("touchstart", onPointerDownOutside);
    return () => {
      document.removeEventListener("mousedown", onPointerDownOutside);
      document.removeEventListener("touchstart", onPointerDownOutside);
    };
  }, [isWalletDropdownOpen]);

  const handleCopyWalletAddress = useCallback(async () => {
    if (!tonAddress) return;
    try {
      await navigator.clipboard.writeText(tonAddress);
      triggerSuccessHaptic();
      toast("Адрес кошелька скопирован", "success", 2200);
    } catch (e) {
      console.error("[wallet] failed to copy address", e);
      toast("Не удалось скопировать адрес", "error");
    } finally {
      setIsWalletDropdownOpen(false);
    }
  }, [tonAddress, toast, triggerSuccessHaptic]);

  const handleDisconnectWallet = useCallback(async () => {
    try {
      await tonConnectUI?.disconnect();
      toast("Кошелек отключен", "info", 2200);
    } catch (e) {
      console.error("[wallet] failed to disconnect", e);
      toast("Не удалось отключить кошелек", "error");
    } finally {
      setIsWalletDropdownOpen(false);
    }
  }, [tonConnectUI, toast]);

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

  const applyChatPenalty = useCallback((retryAfterMs?: number, mutedUntilMs?: number) => {
    const now = Date.now();
    setChatClockMs(now);

    if (typeof mutedUntilMs === "number" && mutedUntilMs > now) {
      setChatMutedUntilMs((prev) => Math.max(prev, mutedUntilMs));
    }

    if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
      const target = now + retryAfterMs;
      setChatCooldownUntilMs((prev) => Math.max(prev, target));
    }
  }, []);

  const handleChatErrorAck = useCallback((errorAck: Exclude<ChatSendAck, { ok: true }>) => {
    if (errorAck.code === "COOLDOWN" || errorAck.code === "RATE_LIMIT" || errorAck.code === "MUTED") {
      applyChatPenalty(errorAck.retryAfterMs, errorAck.mutedUntilMs);
    }

    const retrySec = errorAck.retryAfterMs ? msToSeconds(errorAck.retryAfterMs) : 0;
    if (errorAck.code === "STOPPED") {
      setIsChatSendingEnabled(false);
      toast("Чат остановлен админом", "warning", 2400);
      return;
    }

    if (errorAck.code === "COOLDOWN") {
      toast(`Подождите ${retrySec}с перед следующим сообщением`, "warning", 2200);
      return;
    }

    if (errorAck.code === "MUTED") {
      toast(
        retrySec > 0 ? `Чат временно заблокирован на ${retrySec}с` : "Чат временно заблокирован",
        "error",
        2600
      );
      return;
    }

    if (errorAck.code === "RATE_LIMIT") {
      toast(`Слишком часто. Повторите через ${retrySec}с`, "warning", 2400);
      return;
    }

    if (errorAck.code === "UNAUTHORIZED") {
      toast("Чат недоступен: авторизация не подтверждена", "error");
      return;
    }

    if (errorAck.code === "EMPTY_MESSAGE") {
      toast("Введите сообщение", "warning", 1800);
      return;
    }

    toast("Не удалось отправить сообщение", "error");
  }, [applyChatPenalty, toast]);

  const sendChatMessage = useCallback(async (rawText: string) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      toast("Чат временно недоступен", "error");
      return;
    }

    if (!isChatSendingEnabled) {
      toast("Чат остановлен админом", "warning", 2400);
      return;
    }

    const text = sanitizeChatText(rawText, CHAT_MAX_MESSAGE_LENGTH);
    if (!text) {
      toast("Введите сообщение", "warning", 1800);
      return;
    }

    const now = Date.now();
    if (chatMutedUntilMs > now) {
      const retrySec = msToSeconds(chatMutedUntilMs - now);
      toast(`Чат временно заблокирован на ${retrySec}с`, "error", 2600);
      return;
    }

    if (chatCooldownUntilMs > now) {
      const retrySec = msToSeconds(chatCooldownUntilMs - now);
      toast(`Подождите ${retrySec}с перед следующим сообщением`, "warning", 2200);
      return;
    }

    setIsSendingChat(true);
    try {
      const ack = await new Promise<ChatSendAck | null>((resolve) => {
        let resolved = false;
        const timeoutId = window.setTimeout(() => {
          if (resolved) return;
          resolved = true;
          resolve(null);
        }, 5000);

        socket.emit("chat:send", { text }, (response: unknown) => {
          if (resolved) return;
          resolved = true;
          window.clearTimeout(timeoutId);
          resolve(normalizeChatSendAck(response));
        });
      });

      if (!ack) {
        toast("Чат не ответил. Попробуйте еще раз", "error");
        return;
      }

      if (!ack.ok) {
        handleChatErrorAck(ack);
        return;
      }

      setChatClockMs(Date.now());
      const nextAllowedAtMs =
        Number.isFinite(ack.nextMessageAtMs) && ack.nextMessageAtMs > 0
          ? ack.nextMessageAtMs
          : Date.now() + DEFAULT_CHAT_COOLDOWN_MS;
      setChatCooldownUntilMs((prev) => Math.max(prev, nextAllowedAtMs));
      setChatMessages((prev) => {
        if (prev.some((entry) => entry.id === ack.message.id)) return prev;
        return [...prev, ack.message].slice(-CHAT_HISTORY_LIMIT);
      });
    } finally {
      setIsSendingChat(false);
    }
  }, [chatCooldownUntilMs, chatMutedUntilMs, handleChatErrorAck, isChatSendingEnabled, toast]);

  const deleteChatMessage = useCallback(async (messageId: string) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      toast("Нет соединения с чатом", "error", 2200);
      return;
    }

    if (!isChatAdmin) {
      toast("Недостаточно прав", "error", 2200);
      return;
    }

    const ack = await new Promise<ChatDeleteAck | null>((resolve) => {
      let resolved = false;
      const timeoutId = window.setTimeout(() => {
        if (resolved) return;
        resolved = true;
        resolve(null);
      }, 5000);

      socket.emit("chat:delete", { messageId }, (response: unknown) => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timeoutId);
        resolve(normalizeChatDeleteAck(response));
      });
    });

    if (!ack) {
      toast("Сервер чата не ответил", "error", 2200);
      return;
    }

    if (!ack.ok) {
      toast(ack.error || "Не удалось удалить сообщение", "error", 2400);
      return;
    }

    setChatMessages((prev) => prev.filter((entry) => entry.id !== ack.messageId));
  }, [isChatAdmin, toast]);

  const toggleChatSending = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      toast("Нет соединения с чатом", "error", 2200);
      return;
    }

    if (!isChatAdmin || isTogglingChat) {
      return;
    }

    setIsTogglingChat(true);
    try {
      const ack = await new Promise<ChatToggleAck | null>((resolve) => {
        let resolved = false;
        const timeoutId = window.setTimeout(() => {
          if (resolved) return;
          resolved = true;
          resolve(null);
        }, 5000);

        socket.emit("chat:toggle", { enabled: !isChatSendingEnabled }, (response: unknown) => {
          if (resolved) return;
          resolved = true;
          window.clearTimeout(timeoutId);
          resolve(normalizeChatToggleAck(response));
        });
      });

      if (!ack) {
        toast("Сервер чата не ответил", "error", 2200);
        return;
      }

      if (!ack.ok) {
        toast(ack.error || "Не удалось изменить режим чата", "error", 2400);
        return;
      }

      setIsChatSendingEnabled(ack.sendingEnabled);
      toast(ack.sendingEnabled ? "Чат включен" : "Чат остановлен", "info", 2200);
    } finally {
      setIsTogglingChat(false);
    }
  }, [isChatAdmin, isChatSendingEnabled, isTogglingChat, toast]);

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
    const savedWinners = localStorage.getItem("tonanza_recent_winners");
    if (savedWinners) {
      try {
        const parsed = JSON.parse(savedWinners);
        if (Array.isArray(parsed)) {
          setRecentWinners(parsed.slice(0, 20).map((winner: any) => ({
            id: typeof winner?.id === "string" ? winner.id : createEventId(),
            username: sanitizeDisplayName(winner?.username, "Unknown"),
            payoutNanotons: parseSafeBigInt(winner?.payoutNanotons),
            avatarUrl: sanitizeAvatarUrl(winner?.avatarUrl),
            timestamp: typeof winner?.timestamp === "number" ? winner.timestamp : Date.now()
          })));
        }
      } catch (e) {
        console.warn("Failed to restore winners", e);
      }
    }

    const savedHistory = localStorage.getItem("tonanza_game_history");
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed)) {
          setGameHistory(parsed.slice(0, 30).map((game: any) => ({
            gameId: typeof game?.gameId === "string" ? game.gameId : createEventId(),
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
          })));
        }
      } catch (e) {
        console.warn("Failed to restore history", e);
      }
    }

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
    const saved = localStorage.getItem("tonanza_game_history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const restoredHistory = Array.isArray(parsed)
          ? parsed.slice(0, 30).map((game: any) => ({
            gameId: typeof game?.gameId === "string" ? game.gameId : createEventId(),
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
          }))
          : [];
        setGameHistory(restoredHistory);
        setRecentWinners(restoredHistory.slice(0, 10).map((h: any) => ({
          id: h.gameId,
          username: sanitizeDisplayName(h.winnerName, "Unknown"),
          payoutNanotons: h.payoutNanotons,
          avatarUrl: sanitizeAvatarUrl(h.winnerAvatarUrl),
          timestamp: h.timestamp || Date.now()
        })));
      } catch (e) {
        console.warn("Failed to restore history", e);
      }
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
    const now = Date.now();
    if (chatCooldownUntilMs <= now && chatMutedUntilMs <= now) {
      setChatClockMs(now);
      return;
    }

    setChatClockMs(now);
    const interval = window.setInterval(() => {
      setChatClockMs(Date.now());
    }, 250);
    return () => window.clearInterval(interval);
  }, [chatCooldownUntilMs, chatMutedUntilMs]);

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

    const requestChatHistory = () => {
      socket.emit("chat:getHistory", (response: unknown) => {
        const ack = normalizeChatHistoryAck(response);
        if (!ack || !ack.ok) return;
        setChatMessages(ack.messages.slice(-CHAT_HISTORY_LIMIT));
      });
    };

    const requestChatStatus = () => {
      socket.emit("chat:getStatus", (response: unknown) => {
        if (!response || typeof response !== "object") return;
        const source = response as Record<string, unknown>;
        if (source.ok !== true) return;
        const status = normalizeChatStatusPayload(source);
        if (!status) return;
        setIsChatSendingEnabled(status.sendingEnabled);
      });
    };

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
      requestChatHistory();
      requestChatStatus();
    });
    socket.on("disconnect", () => {
      setIsSocketConnected(false);
    });
    socket.on("chat:history", (payload: unknown) => {
      if (!Array.isArray(payload)) return;
      const normalized = payload
        .map((entry) => normalizeChatMessage(entry))
        .filter((entry): entry is ChatMessage => entry !== null)
        .slice(-CHAT_HISTORY_LIMIT);
      setChatMessages(normalized);
    });
    socket.on("chat:new", (payload: unknown) => {
      const message = normalizeChatMessage(payload);
      if (!message) return;
      setChatMessages((prev) => {
        if (prev.some((entry) => entry.id === message.id)) return prev;
        return [...prev, message].slice(-CHAT_HISTORY_LIMIT);
      });
    });
    socket.on("chat:deleted", (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const source = payload as Record<string, unknown>;
      if (typeof source.messageId !== "string" || source.messageId.length === 0) return;
      setChatMessages((prev) => prev.filter((entry) => entry.id !== source.messageId));
    });
    socket.on("chat:status", (payload: unknown) => {
      const status = normalizeChatStatusPayload(payload);
      if (!status) return;
      setIsChatSendingEnabled(status.sendingEnabled);
    });
    socket.on("chat:role", (payload: unknown) => {
      const role = normalizeChatRolePayload(payload);
      if (!role) return;
      setIsChatAdmin(role.isAdmin);
    });
    socket.on("chat:error", (payload: unknown) => {
      const ack = normalizeChatSendAck(payload);
      if (!ack || ack.ok) return;
      handleChatErrorAck(ack);
    });

    socket.on("game:resolved", handleResolveResult);
    socket.on("online_users", (count: number) => setOnlineUsers(count));
    requestChatHistory();
    requestChatStatus();
    return () => {
      socket.disconnect();
      socketRef.current = null;
      setIsSocketConnected(false);
      setIsChatAdmin(false);
    };
  }, [appAccessAllowed, handleResolveResult, handleChatErrorAck, socketBaseUrl, upsertPlayerBet, userId, serverUserId, handleBetCancelled, upsertBetEvent]);

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
  const chatCooldownMsLeft = Math.max(0, chatCooldownUntilMs - chatClockMs);
  const chatMutedMsLeft = Math.max(0, chatMutedUntilMs - chatClockMs);

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

        {/* A. HEADER (Fixed Top) */}
        <div
          className={`fixed top-0 left-0 right-0 max-w-md mx-auto z-50 bg-teal-950/80 backdrop-blur-md border-b border-cyan-400/10 flex items-center justify-between px-4 ${isDesktop ? "py-3" : "pb-3"}`}
          style={isDesktop ? undefined : { paddingTop: MOBILE_HEADER_PADDING_TOP }}
        >
        {/* Left: Balance with Wallet Controls */}
        <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
          <div className="flex flex-col leading-none">
            <span className="text-[9px] text-white/40 uppercase font-bold">Баланс</span>
            <span className="text-sm font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 drop-shadow-[0_0_10px_rgba(251,191,36,0.4)]">
              {formatNanotonsBalance(localBalanceNanotons).replace(" TON", "")}
            </span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => {
                triggerSelectionHaptic();
                soundEngine.playUiClick();
                setPaymentModalMode("deposit");
                setIsPaymentModalOpen(true);
              }}
              className="w-6 h-6 rounded bg-gradient-to-br from-emerald-500 to-teal-600 hover:brightness-110 active:scale-95 transition-all duration-200 ease-out flex items-center justify-center text-white font-bold text-xs"
              title="Депозит"
            >
              +
            </button>
            <button
              onClick={() => {
                triggerSelectionHaptic();
                soundEngine.playUiClick();
                setPaymentModalMode("withdraw");
                setIsPaymentModalOpen(true);
              }}
              className="w-6 h-6 rounded bg-gradient-to-br from-rose-500 to-orange-600 hover:brightness-110 active:scale-95 transition-all duration-200 ease-out flex items-center justify-center text-white font-bold text-xs"
              title="Вывод"
            >
              −
            </button>
          </div>
        </div>

        {/* Center: Wallet Connect */}
        <div className="scale-75 origin-center">
          {!tonWallet ? (
            <TonConnectButton className="wallet-connect-compact" />
          ) : (
            <div ref={walletDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  triggerSelectionHaptic();
                  soundEngine.playUiClick();
                  setIsWalletDropdownOpen((prev) => !prev);
                }}
                className="h-10 w-[142px] rounded-xl border border-white/10 bg-white/5 px-3 text-white shadow-[0_4px_16px_rgba(2,6,23,0.5)] transition-all hover:bg-white/10 active:scale-95 flex items-center justify-between gap-1.5"
                aria-label="Меню кошелька"
                aria-expanded={isWalletDropdownOpen}
              >
                <span className="font-mono text-[14px] font-semibold leading-none">
                  {compactTonAddress}
                </span>
                <ChevronDown
                  size={14}
                  className={`text-white/70 transition-transform ${isWalletDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence mode="wait" initial={false}>
                {isWalletDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute right-0 top-full mt-2 w-40 overflow-hidden rounded-xl border border-white/10 bg-slate-950/95 backdrop-blur-xl shadow-[0_14px_30px_rgba(2,6,23,0.65)]"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        triggerSelectionHaptic();
                        soundEngine.playUiClick();
                        void handleCopyWalletAddress();
                      }}
                      className="w-full px-3 py-2.5 text-left text-sm text-white/85 hover:bg-white/10 transition-all duration-200 ease-out active:scale-[0.99] flex items-center gap-2"
                    >
                      <Copy size={14} />
                      Копировать
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerSelectionHaptic();
                        soundEngine.playUiClick();
                        void handleDisconnectWallet();
                      }}
                      className="w-full px-3 py-2.5 text-left text-sm text-rose-300 hover:bg-rose-500/10 transition-all duration-200 ease-out active:scale-[0.99] flex items-center gap-2"
                    >
                      <LogOut size={14} />
                      Отключить
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Right: Online Badge + Menu */}
        <div className="flex items-center gap-3">
          {/* Online Badge */}
          <div className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-full border border-white/5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse" />
            <span className="text-xs font-mono font-bold text-white/80">
              {onlineUsers}
            </span>
          </div>

          {/* Menu Button */}
          <button
            onClick={() => {
              triggerSelectionHaptic();
              soundEngine.playUiClick();
              setIsMenuOpen(true);
            }}
            className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 active:scale-95 transition-all duration-200 ease-out"
            aria-label="Открыть меню"
          >
            <Menu size={18} />
          </button>
        </div>
        </div>

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
            messages={chatMessages}
            currentUserId={effectiveUserId}
            isConnected={isSocketConnected}
            isSending={isSendingChat}
            isSendingEnabled={isChatSendingEnabled}
            isAdmin={isChatAdmin}
            isTogglingChat={isTogglingChat}
            cooldownMsLeft={chatCooldownMsLeft}
            mutedMsLeft={chatMutedMsLeft}
            maxMessageLength={CHAT_MAX_MESSAGE_LENGTH}
            onSend={sendChatMessage}
            onDeleteMessage={deleteChatMessage}
            onToggleChat={toggleChatSending}
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

      {/* Fairness Modal Overlay */}
      <AnimatePresence>
        {showFairness && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setShowFairness(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.975, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.985, y: 10 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="bg-slate-900 border border-white/10 p-6 rounded-2xl max-w-sm w-full"
              onClick={e => e.stopPropagation()}
            >
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
                  className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-sm transition-all duration-200 ease-out active:scale-[0.99]"
                >
                  Закрыть
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* WINNING MOMENT OVERLAY */}
      {showWinnerModal && (
        <div className="fixed inset-0 z-[220] bg-black/85 backdrop-blur-md">
          <div className="mx-auto flex h-full w-full max-w-md items-center justify-center p-4">
            <div className="relative w-full max-w-sm overflow-hidden rounded-[2rem] border border-amber-300/60 bg-slate-900 text-center text-white shadow-[0_0_50px_rgba(255,215,0,0.3)]">
              <div className="absolute inset-0 bg-gradient-brand opacity-10 pointer-events-none" />

              <div className="relative p-8">
                <motion.div
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="mb-4 text-6xl drop-shadow-[0_0_15px_rgba(255,215,0,0.8)]"
                >
                  👑
                </motion.div>

                <h2 className="mb-2 text-2xl font-black uppercase tracking-widest text-white">Джекпот!</h2>

                <div className="mb-6 text-sm font-bold uppercase tracking-wide text-white/70">
                  Победитель забирает всё
                </div>

                <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-4xl font-mono font-black text-amber-300 drop-shadow-[0_0_12px_rgba(251,191,36,0.35)]">
                    {winningAmount ? formatNanotonsCompact(parseSafeBigInt(winningAmount)) : "---"}
                  </div>
                </div>

                <button
                  onClick={() => void handleClaimPrize()}
                  disabled={isClaimingPrize}
                  className="w-full rounded-xl bg-gradient-gold py-4 text-black font-black uppercase tracking-widest shadow-[0_0_20px_rgba(255,215,0,0.4)] transition-all hover:brightness-110 active:translate-y-0.5 active:scale-95"
                >
                  {isClaimingPrize ? "Зачисляем..." : isWinningPrizeCredited ? "Продолжить" : "Забрать выигрыш"}
                </button>
              </div>
            </div>
          </div>
        </div>
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
