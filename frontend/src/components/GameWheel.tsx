import { AnimatePresence, motion } from "framer-motion";
import { Crown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatNanotonsCompact } from "../lib/format";
import { hapticNotificationSuccess } from "../lib/telegram";
import type { PlayerChance } from "../types";

type GameWheelProps = {
  players: PlayerChance[];
  totalPotNanotons: bigint;
  winnerUserId: string | null;
  spinRoundKey: number;
  isRoundActive: boolean;
  onSpinFinished?: (winnerUserId: string | null) => void;
};

type WheelSector = {
  userId: string;
  name: string;
  amountNanotons: bigint;
  ratio: number;
  start: number;
  end: number;
  color: string;
};

const normalizeDeg = (value: number) => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const buildFallbackSectors = (): WheelSector[] => {
  return [
    { userId: "demo-a", name: "Waiting", amountNanotons: 1n, ratio: 0.25, start: 0, end: 90, color: "#155e75" },
    { userId: "demo-b", name: "for", amountNanotons: 1n, ratio: 0.25, start: 90, end: 180, color: "#0f766e" },
    { userId: "demo-c", name: "the", amountNanotons: 1n, ratio: 0.25, start: 180, end: 270, color: "#be185d" },
    { userId: "demo-d", name: "next bet", amountNanotons: 1n, ratio: 0.25, start: 270, end: 360, color: "#a16207" }
  ];
};

const confettiPieces = Array.from({ length: 44 }).map((_, index) => {
  return {
    id: index,
    x: Math.random() * 280 - 140,
    y: Math.random() * -260 - 40,
    rotate: Math.random() * 420,
    delay: Math.random() * 0.3,
    scale: 0.5 + Math.random() * 0.9,
    color: ["#ec4899", "#facc15", "#2dd4bf", "#f97316", "#a78bfa"][index % 5]
  };
});

export const GameWheel = ({
  players,
  totalPotNanotons,
  winnerUserId,
  spinRoundKey,
  isRoundActive,
  onSpinFinished
}: GameWheelProps) => {
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showWinnerCard, setShowWinnerCard] = useState(false);
  const [lastWinnerId, setLastWinnerId] = useState<string | null>(null);
  const currentRotationRef = useRef(0);

  const sectors = useMemo(() => {
    if (players.length === 0 || totalPotNanotons <= 0n) {
      return buildFallbackSectors();
    }

    const safeTotal = Number(totalPotNanotons);
    let cursor = 0;

    return players.map((player, index) => {
      const ratio = Number(player.amountNanotons) / safeTotal;
      const angle = index === players.length - 1 ? 360 - cursor : ratio * 360;
      const start = cursor;
      const end = cursor + angle;
      cursor = end;

      return {
        userId: player.userId,
        name: player.name,
        amountNanotons: player.amountNanotons,
        ratio,
        start,
        end,
        color: player.color
      };
    });
  }, [players, totalPotNanotons]);

  const gradient = useMemo(() => {
    return `conic-gradient(${sectors
      .map((sector) => `${sector.color} ${sector.start.toFixed(2)}deg ${sector.end.toFixed(2)}deg`)
      .join(", ")})`;
  }, [sectors]);

  const winnerName = useMemo(() => {
    if (!lastWinnerId) {
      return null;
    }

    return players.find((player) => player.userId === lastWinnerId)?.name ?? `User ${lastWinnerId.slice(-4)}`;
  }, [lastWinnerId, players]);

  useEffect(() => {
    if (!winnerUserId || spinRoundKey === 0) {
      return;
    }

    const winnerSector = sectors.find((sector) => sector.userId === winnerUserId);
    if (!winnerSector) {
      return;
    }

    setShowConfetti(false);
    setShowWinnerCard(false);
    setIsSpinning(true);

    const winnerCenter = (winnerSector.start + winnerSector.end) / 2;
    const desiredAtPointer = normalizeDeg(-90 - winnerCenter);
    const current = normalizeDeg(currentRotationRef.current);

    let delta = desiredAtPointer - current;
    if (delta < 0) {
      delta += 360;
    }

    const target = currentRotationRef.current + 360 * 5 + delta;
    currentRotationRef.current = target;
    setRotation(target);

    const finishTimer = window.setTimeout(() => {
      setIsSpinning(false);
      setLastWinnerId(winnerUserId);
      setShowWinnerCard(true);
      setShowConfetti(true);
      hapticNotificationSuccess();
      onSpinFinished?.(winnerUserId);

      window.setTimeout(() => {
        setShowConfetti(false);
      }, 1800);
    }, 4250);

    return () => {
      window.clearTimeout(finishTimer);
    };
  }, [winnerUserId, spinRoundKey, sectors, onSpinFinished]);

  return (
    <section className="relative mx-auto w-full max-w-[420px]">
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-teal-400/20 blur-[80px]" />

      <div className="relative rounded-[2.2rem] border border-teal-500/10 bg-teal-900/20 p-4 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-[0.24em] text-teal-200/70">
          <span>Chance Wheel</span>
          <span className="font-mono text-amber-300">{formatNanotonsCompact(totalPotNanotons)}</span>
        </div>

        <motion.div
          className="relative mx-auto aspect-square w-full max-w-[340px]"
          animate={isRoundActive && !isSpinning ? { scale: [1, 1.017, 1] } : { scale: 1 }}
          transition={
            isRoundActive && !isSpinning
              ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.25 }
          }
        >
          <div className="absolute left-1/2 top-1 z-30 h-0 w-0 -translate-x-1/2 border-l-[11px] border-r-[11px] border-t-[20px] border-l-transparent border-r-transparent border-t-pink-400 drop-shadow-[0_0_14px_rgba(236,72,153,0.65)]" />

          <motion.div
            className="relative h-full w-full rounded-full border border-teal-300/25 shadow-glow"
            animate={{ rotate: rotation }}
            transition={{
              duration: isSpinning ? 4.2 : 0,
              ease: [0.08, 0.86, 0.2, 1]
            }}
          >
            <div className="absolute inset-0 rounded-full" style={{ backgroundImage: gradient }} />
            <div className="absolute inset-2 rounded-full border border-slate-50/10" />
            <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_22%,rgba(255,255,255,0.22),transparent_48%)]" />
            <div className="absolute inset-0 rounded-full shadow-[inset_0_0_45px_rgba(2,132,199,0.35)]" />
          </motion.div>

          <div className="absolute left-1/2 top-1/2 z-20 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-200/45 bg-slate-950/85 backdrop-blur-md">
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Crown className="mb-1 h-5 w-5 text-amber-300" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-teal-200/70">Jackpot</span>
              <span className="font-mono text-sm font-semibold text-amber-300">{formatNanotonsCompact(totalPotNanotons)}</span>
            </div>
          </div>

          <AnimatePresence>
            {showConfetti && (
              <div className="pointer-events-none absolute inset-0 z-40">
                {confettiPieces.map((piece) => (
                  <motion.span
                    key={piece.id}
                    className="absolute left-1/2 top-1/2 h-2.5 w-1.5 rounded-sm"
                    style={{ backgroundColor: piece.color }}
                    initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 }}
                    animate={{
                      x: piece.x,
                      y: piece.y,
                      rotate: piece.rotate,
                      scale: piece.scale,
                      opacity: 0
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.2, delay: piece.delay, ease: "easeOut" }}
                  />
                ))}
              </div>
            )}
          </AnimatePresence>
        </motion.div>

        <ul className="mt-4 grid grid-cols-2 gap-2">
          {sectors.slice(0, 6).map((sector) => (
            <li
              key={sector.userId}
              className="flex items-center justify-between gap-2 rounded-xl border border-teal-500/10 bg-slate-900/55 px-3 py-2"
            >
              <span className="inline-flex items-center gap-2 truncate text-xs text-slate-100">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sector.color }} />
                <span className="truncate">{sector.name}</span>
              </span>
              <span className="font-mono text-xs text-teal-200/90">{(sector.ratio * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>

      <AnimatePresence>
        {showWinnerCard && winnerName && (
          <motion.div
            initial={{ opacity: 0, y: 26, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            className="absolute inset-x-4 bottom-4 rounded-2xl border border-amber-300/50 bg-gradient-to-r from-amber-300/20 to-yellow-500/20 p-4 backdrop-blur-md"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200/90">Winner</p>
            <p className="mt-1 text-lg font-semibold text-amber-300">{winnerName}</p>
            <p className="font-mono text-sm text-slate-100">{formatNanotonsCompact(totalPotNanotons)}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
