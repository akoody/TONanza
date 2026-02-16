import { Crown, Clock3, UserCircle2, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { BettingControls } from "./components/BettingControls";
import { GameWheel } from "./components/GameWheel";
import { LiveFeed } from "./components/LiveFeed";
import { getActiveGame, healthCheck, placeBet, resolveGame } from "./lib/api";
import { formatNanotonsCompact, randomColorByUserId } from "./lib/format";
import { getTelegramUserId, hapticSelectionChanged, initTelegram } from "./lib/telegram";
import type { LiveEvent, PlayerChance, ResolveResponse } from "./types";

const NANOTONS_PER_TON = 1_000_000_000n;
const DEFAULT_BALANCE = 40n * NANOTONS_PER_TON;
const ROUND_SECONDS = 90;

const createEventId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
};

const formatTimer = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const min = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const sec = (safe % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
};

const randomDemoHash = () => {
  return Array.from({ length: 64 })
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
};

const demoNames = ["Astra", "Nova", "Mako", "Vega", "Nyx", "Orion"];

export default function App() {
  const [userId, setUserId] = useState("1001001");
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
  const [statusText, setStatusText] = useState<string>("Connecting to backend...");
  const [localBalanceNanotons, setLocalBalanceNanotons] = useState<bigint>(DEFAULT_BALANCE);

  const socketRef = useRef<Socket | null>(null);
  const resolvedRoundRef = useRef<string | null>(null);

  const pushEvent = useCallback((text: string) => {
    setEvents((prev) => [{ id: createEventId(), text, createdAt: Date.now() }, ...prev].slice(0, 6));
  }, []);

  const resetForNextRound = useCallback((nextRound: { gameId: string; seedHash: string; endsAt: number }) => {
    resolvedRoundRef.current = null;
    setActiveGameId(nextRound.gameId);
    setServerSeedHash(nextRound.seedHash);
    setPlayers([]);
    setTotalPotNanotons(0n);
    setWinnerUserId(null);
    setRoundEndsAtMs(nextRound.endsAt);
    setRemainingSeconds(Math.max(0, Math.ceil((nextRound.endsAt - Date.now()) / 1000)));
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
          .sort((a, b) => Number(b.amountNanotons - a.amountNanotons));
      }

      const next: PlayerChance = {
        userId: id,
        name: label ?? (id === userId ? "You" : `Player #${id.slice(-4)}`),
        amountNanotons,
        color: randomColorByUserId(id)
      };

      return [...prev, next].sort((a, b) => Number(b.amountNanotons - a.amountNanotons));
    });
  }, [userId]);

  const startDemoRound = useCallback((message?: string) => {
    resetForNextRound({
      gameId: `demo-${Date.now()}`,
      seedHash: randomDemoHash(),
      endsAt: Date.now() + ROUND_SECONDS * 1000
    });

    if (message) {
      pushEvent(message);
    }
  }, [pushEvent, resetForNextRound]);

  const fetchActiveRound = useCallback(async () => {
    const active = await getActiveGame();
    const nextGameId = active.id;
    const nextEndsAt = new Date(active.endsAt).getTime();

    resolvedRoundRef.current = null;
    setActiveGameId(nextGameId);
    setServerSeedHash(active.serverSeedHash);
    setWinnerUserId(null);
    setRemainingSeconds(Math.max(0, Math.ceil((nextEndsAt - Date.now()) / 1000)));
    setRoundEndsAtMs(nextEndsAt);
    setTotalPotNanotons(BigInt(active.totalPotNanotons));
    setPlayers([]);
  }, []);

  const handleResolveResult = useCallback((resolved: ResolveResponse) => {
    if (!resolved.winnerId) {
      pushEvent("Round ended with no bets. Next round is live.");
      setWinnerUserId(null);
      setTimeout(() => {
        void fetchActiveRound();
      }, 500);
      return;
    }

    setWinnerUserId(resolved.winnerId);
    setSpinRoundKey((prev) => prev + 1);
    setTotalPotNanotons(BigInt(resolved.totalPotNanotons));
    pushEvent(`Winner: #${resolved.winnerId.slice(-4)} won ${formatNanotonsCompact(BigInt(resolved.payoutNanotons))}`);

    setTimeout(() => {
      void fetchActiveRound();
    }, 5600);
  }, [fetchActiveRound, pushEvent]);

  const resolveCurrentRound = useCallback(async () => {
    if (!activeGameId || resolvedRoundRef.current === activeGameId) {
      return;
    }

    resolvedRoundRef.current = activeGameId;

    if (isDemoMode) {
      if (players.length === 0) {
        pushEvent("No bets in round. Demo round restarted.");
        startDemoRound();
        return;
      }

      const totalWeight = players.reduce((acc, entry) => acc + Number(entry.amountNanotons), 0);
      let pivot = Math.random() * totalWeight;
      let picked = players[0]?.userId ?? null;

      for (const entry of players) {
        pivot -= Number(entry.amountNanotons);
        if (pivot <= 0) {
          picked = entry.userId;
          break;
        }
      }

      if (picked) {
        const payout = (totalPotNanotons * 95n) / 100n;
        handleResolveResult({
          status: "FINISHED",
          gameId: activeGameId,
          winnerId: picked,
          winningTicket: "1",
          payoutNanotons: payout.toString(),
          commissionNanotons: (totalPotNanotons - payout).toString(),
          totalPotNanotons: totalPotNanotons.toString(),
          proof: {
            algorithm: "demo-weighted-random",
            serverSeed: "demo",
            serverSeedHash,
            clientSeed: "demo",
            totalTickets: totalPotNanotons.toString(),
            winningTicket: "1"
          }
        });
      }

      return;
    }

    try {
      setIsResolvingRound(true);
      const resolved = await resolveGame(activeGameId);
      handleResolveResult(resolved);
    } catch (error) {
      resolvedRoundRef.current = null;
      const message = error instanceof Error ? error.message : "Failed to resolve";
      setStatusText(message);
    } finally {
      setIsResolvingRound(false);
    }
  }, [
    activeGameId,
    handleResolveResult,
    isDemoMode,
    players,
    pushEvent,
    serverSeedHash,
    startDemoRound,
    totalPotNanotons
  ]);

  useEffect(() => {
    initTelegram();

    const telegramId = getTelegramUserId();
    const savedUser = localStorage.getItem("tonanza_user_id");
    const resolvedUser = String(telegramId ?? savedUser ?? "1001001");

    setUserId(resolvedUser);
    localStorage.setItem("tonanza_user_id", resolvedUser);

    const savedBalance = localStorage.getItem("tonanza_local_balance");
    if (savedBalance && /^\d+$/.test(savedBalance)) {
      setLocalBalanceNanotons(BigInt(savedBalance));
    }

    const bootstrap = async () => {
      try {
        await healthCheck();
        await fetchActiveRound();
        setIsDemoMode(false);
        setStatusText("Connected. Live mode.");
      } catch {
        setIsDemoMode(true);
        setStatusText("Backend unavailable. Demo mode enabled.");
        startDemoRound("Demo mode: backend is unreachable, local simulation started.");
      }
    };

    void bootstrap();
  }, [fetchActiveRound, startDemoRound]);

  useEffect(() => {
    localStorage.setItem("tonanza_local_balance", localBalanceNanotons.toString());
  }, [localBalanceNanotons]);

  useEffect(() => {
    if (isDemoMode) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io(undefined, {
      path: "/socket.io",
      transports: ["websocket", "polling"]
    });

    socketRef.current = socket;

    socket.on("game:betPlaced", (payload: { userId: string; amountNanotons: string; totalPotNanotons: string; endsAt: string }) => {
      const amount = BigInt(payload.amountNanotons);
      upsertPlayerBet(payload.userId, amount);
      setTotalPotNanotons(BigInt(payload.totalPotNanotons));
      setRoundEndsAtMs(new Date(payload.endsAt).getTime());
      pushEvent(`Player #${payload.userId.slice(-4)} joined with ${formatNanotonsCompact(amount)}`);
    });

    socket.on("game:resolved", (payload: ResolveResponse) => {
      handleResolveResult(payload);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [handleResolveResult, isDemoMode, pushEvent, upsertPlayerBet]);

  useEffect(() => {
    if (!isDemoMode || !activeGameId || remainingSeconds <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      const randomName = demoNames[Math.floor(Math.random() * demoNames.length)] ?? "Bot";
      const randomId = `bot-${Math.floor(Math.random() * 6) + 1}`;
      const randomTon = BigInt(Math.floor(Math.random() * 3) + 1) * NANOTONS_PER_TON;
      upsertPlayerBet(randomId, randomTon, randomName);
      setTotalPotNanotons((prev) => prev + randomTon);
      pushEvent(`${randomName} jumped in with ${formatNanotonsCompact(randomTon)}`);
    }, 3600);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeGameId, isDemoMode, pushEvent, remainingSeconds, upsertPlayerBet]);

  useEffect(() => {
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((roundEndsAtMs - Date.now()) / 1000));
      setRemainingSeconds((prev) => {
        if (seconds !== prev && seconds > 0) {
          hapticSelectionChanged();
        }
        return seconds;
      });
    };

    tick();
    const timerId = window.setInterval(tick, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [roundEndsAtMs]);

  useEffect(() => {
    if (remainingSeconds === 0) {
      void resolveCurrentRound();
    }
  }, [remainingSeconds, resolveCurrentRound]);

  const timerColorClass = useMemo(() => {
    if (remainingSeconds <= 10) {
      return "text-rose-300";
    }
    if (remainingSeconds <= 25) {
      return "text-amber-300";
    }
    return "text-emerald-300";
  }, [remainingSeconds]);

  const placeBetAction = useCallback(async (amountNanotons: bigint) => {
    if (!activeGameId) {
      return;
    }

    setIsSubmittingBet(true);

    try {
      if (isDemoMode) {
        upsertPlayerBet(userId, amountNanotons, "You");
        setTotalPotNanotons((prev) => prev + amountNanotons);
        setLocalBalanceNanotons((prev) => (prev > amountNanotons ? prev - amountNanotons : 0n));
        pushEvent(`You bet ${formatNanotonsCompact(amountNanotons)}`);
        return;
      }

      const response = await placeBet({
        userId,
        amountNanotons: amountNanotons.toString()
      });

      upsertPlayerBet(userId, amountNanotons, "You");
      setTotalPotNanotons(BigInt(response.totalPotNanotons));
      setRoundEndsAtMs(new Date(response.endsAt).getTime());
      setLocalBalanceNanotons((prev) => (prev > amountNanotons ? prev - amountNanotons : 0n));
      setStatusText("Bet accepted.");
      pushEvent(`You joined with ${formatNanotonsCompact(amountNanotons)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to place bet";
      setStatusText(message);
    } finally {
      setIsSubmittingBet(false);
    }
  }, [activeGameId, isDemoMode, pushEvent, upsertPlayerBet, userId]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-b from-slate-900 via-teal-950 to-slate-900 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-12 h-56 w-56 rounded-full bg-teal-500/15 blur-3xl" />
        <div className="absolute -right-24 top-36 h-72 w-72 rounded-full bg-pink-500/10 blur-3xl" />
        <div className="absolute bottom-20 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-[640px] flex-col gap-4 px-4 pb-56 pt-5">
        <header className="rounded-2xl border border-teal-500/10 bg-teal-900/20 p-4 backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-teal-200/70">Jackpot PvP</p>
              <h1 className="mt-1 text-xl font-semibold">Deep Sea Cyber Arena</h1>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs ${
                isDemoMode
                  ? "border border-amber-400/35 bg-amber-500/10 text-amber-300"
                  : "border border-emerald-400/35 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              {isDemoMode ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
              {isDemoMode ? "Demo" : "Live"}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-3">
            <label className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-teal-500/10 bg-slate-900/65 px-3">
              <UserCircle2 className="h-4 w-4 text-teal-300" />
              <input
                value={userId}
                onChange={(event) => {
                  const sanitized = event.target.value.replace(/\D/g, "");
                  setUserId(sanitized || "0");
                  localStorage.setItem("tonanza_user_id", sanitized || "0");
                }}
                className="w-full bg-transparent font-mono text-sm text-slate-100 outline-none"
                inputMode="numeric"
              />
            </label>

            <div className="rounded-xl border border-teal-500/10 bg-slate-900/65 px-3 py-2 text-right">
              <p className="text-[10px] uppercase tracking-[0.18em] text-teal-200/60">Pot</p>
              <p className="font-mono text-sm text-amber-300">{formatNanotonsCompact(totalPotNanotons)}</p>
            </div>
          </div>

          <p className="mt-3 text-xs text-teal-100/70">{statusText}</p>
        </header>

        <section className="rounded-2xl border border-teal-500/10 bg-slate-900/55 px-4 py-3 text-center backdrop-blur-md">
          <p className="mb-1 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-teal-200/70">
            <Clock3 className="h-3.5 w-3.5" />
            Round timer
          </p>
          <p className={`font-mono text-5xl font-semibold ${timerColorClass}`}>{formatTimer(remainingSeconds)}</p>
          <p className="mt-1 text-xs text-teal-200/70">Hash: {serverSeedHash.slice(0, 14)}...</p>
        </section>

        <LiveFeed events={events} />

        <GameWheel
          players={players}
          totalPotNanotons={totalPotNanotons}
          winnerUserId={winnerUserId}
          spinRoundKey={spinRoundKey}
          isRoundActive={remainingSeconds > 0 || isResolvingRound}
        />

        <section className="rounded-2xl border border-teal-500/10 bg-teal-900/20 p-4 backdrop-blur-md">
          <p className="mb-2 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-teal-200/70">
            <Crown className="h-3.5 w-3.5 text-amber-300" />
            Fairness
          </p>
          <p className="text-sm text-slate-200/90">
            Winner is decided by provably-fair seed mix: `sha256(serverSeed:clientSeed)`.
          </p>
          <p className="mt-2 font-mono text-xs text-teal-200/80">Server Seed Hash: {serverSeedHash}</p>
        </section>
      </main>

      <BettingControls
        balanceNanotons={localBalanceNanotons}
        isSubmitting={isSubmittingBet}
        disabled={!activeGameId || remainingSeconds <= 0}
        onPlaceBet={placeBetAction}
      />
    </div>
  );
}
