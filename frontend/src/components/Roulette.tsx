import { motion, useAnimation, useMotionValue } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";

export interface RoulettePlayer {
    id: string;
    name: string;
    avatarUrl: string;
    color: string;
    chancePercent: number;
}

interface RouletteProps {
    players: RoulettePlayer[];
    winnerId: string | null;
    isSpinning: boolean;
    spinKey: number;
    spinDurationMs?: number;
    spinSeed?: string | null;
    onFinish: () => void;
}

const CARD_WIDTH = 118;
const GAP = 6;
const ITEM_SIZE = CARD_WIDTH + GAP;
const TAPE_LENGTH = 72;
const WINNER_INDEX = 60;
const DEFAULT_SPIN_DURATION_MS = 14_000;
const SPIN_EASE: [number, number, number, number] = [0.08, 0.76, 0.16, 1];

const createSeededRandom = (seedInput: string) => {
    let seed = 2166136261 >>> 0;
    for (let i = 0; i < seedInput.length; i += 1) {
        seed ^= seedInput.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
    }

    if (seed === 0) seed = 1;

    return () => {
        seed += 0x6D2B79F5;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

export function Roulette({
    players,
    winnerId,
    isSpinning,
    spinKey,
    spinDurationMs = DEFAULT_SPIN_DURATION_MS,
    spinSeed = null,
    onFinish
}: RouletteProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const controls = useAnimation();
    const x = useMotionValue(0);
    const hasStartedSpinRef = useRef(false);

    const [tape, setTape] = useState<RoulettePlayer[]>([]);

    // Build the tape when players change or a new spin is triggered
    useEffect(() => {
        if (players.length === 0) return;
        // Freeze tape composition while spin is active to prevent visual jumps.
        if (isSpinning && hasStartedSpinRef.current) return;
        const stablePlayers = [...players].sort((left, right) => left.id.localeCompare(right.id));
        const tapeSeed = spinSeed ?? `${spinKey}:${winnerId ?? "none"}:${stablePlayers.map((p) => p.id).join(",")}`;
        const random = createSeededRandom(tapeSeed);

        // Fill tape from players, then deterministically shuffle for same order on all clients.
        const newTape = Array.from({ length: TAPE_LENGTH }).map((_, i) => {
            return stablePlayers[i % stablePlayers.length];
        });

        for (let i = newTape.length - 1; i > 0; i--) {
            if (i === WINNER_INDEX) continue;
            const j = Math.floor(random() * (i + 1));
            if (j === WINNER_INDEX) continue;
            [newTape[i], newTape[j]] = [newTape[j], newTape[i]];
        }

        if (winnerId) {
            const winner = players.find(p => p.id === winnerId);
            if (winner) {
                newTape[WINNER_INDEX] = winner;
            }
        }

        setTape(newTape);
    }, [players, winnerId, spinKey, spinSeed, isSpinning]);

    // Handle Spin — ALWAYS reset to 0 first, then animate
    useEffect(() => {
        if (isSpinning && winnerId && containerRef.current) {
            // Prevent double-start for same spinKey
            if (hasStartedSpinRef.current) return;
            hasStartedSpinRef.current = true;

            const containerWidth = containerRef.current.offsetWidth;

            // STEP 1: Reset position to start
            controls.stop();
            controls.set({ x: 0 });
            x.set(0);

            // STEP 2: After a frame, start the animation
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const centerOffset = (containerWidth / 2) - (CARD_WIDTH / 2);
                    const baseTarget = -1 * (WINNER_INDEX * ITEM_SIZE) + centerOffset;

                    // Deterministic offset so all users land on the same visual position.
                    const safeZone = (CARD_WIDTH / 2) - 15;
                    const offsetSeed = `${spinSeed ?? spinKey}:${winnerId ?? "none"}:offset`;
                    const offsetRandom = createSeededRandom(offsetSeed);
                    const randomOffset = Math.floor(offsetRandom() * ((safeZone * 2) + 1)) - safeZone;

                    const targetX = baseTarget + randomOffset;

                    controls.start({
                        x: targetX,
                        transition: {
                            type: "tween",
                            duration: Math.max(0.4, spinDurationMs / 1000),
                            ease: SPIN_EASE,
                        }
                    }).then(() => {
                        onFinish();
                    });
                });
            });
        } else if (!isSpinning) {
            // Reset for next round
            hasStartedSpinRef.current = false;
            controls.stop();
            controls.set({ x: 0 });
            x.set(0);
        }
    }, [isSpinning, winnerId, spinKey, controls, onFinish, x, spinDurationMs, spinSeed]);

    // Empty state: decorative roulette with sectors
    const PLACEHOLDER_COLORS = [
        "#06b6d4", "#F700FF", "#FFD700", "#22c55e",
        "#6366f1", "#fb7185", "#FFAA00", "#14b8a6"
    ];

    if (players.length === 0) {
        return (
            <div className="relative w-full h-[136px] rounded-2xl border border-cyan-400/15 bg-[linear-gradient(180deg,rgba(8,26,40,0.82),rgba(2,12,22,0.88))] backdrop-blur-md overflow-hidden">
                {/* Laser scanner in idle mode */}
                <div className="absolute left-1/2 top-0 bottom-0 w-[2px] bg-cyan-400/45 z-30 -translate-x-1/2 shadow-[0_0_14px_rgba(6,182,212,0.45)]">
                    <div className="absolute top-0 -left-[5px] w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[9px] border-t-cyan-300/70" />
                    <div className="absolute bottom-0 -left-[5px] w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[9px] border-b-cyan-300/70" />
                </div>

                <div className="absolute inset-0">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <motion.div
                                key={`placeholder-${i}`}
                                initial={{ opacity: 0, scale: 0.94 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: i * 0.04, duration: 0.25 }}
                                style={{
                                    width: CARD_WIDTH,
                                    marginRight: GAP
                                }}
                                className="relative h-[104px] rounded-xl flex-shrink-0 flex flex-col items-center justify-center border border-cyan-300/15 bg-slate-900/55 overflow-hidden"
                            >
                                <div
                                    className="absolute inset-0 opacity-15"
                                    style={{ backgroundColor: PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length] }}
                                />
                                <div className="w-12 h-12 rounded-full border-2 border-white/10 mb-2 flex items-center justify-center">
                                    <div
                                        className="w-6 h-6 rounded-full opacity-35"
                                        style={{ backgroundColor: PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length] }}
                                    />
                                </div>
                                <div className="w-14 h-1.5 bg-white/8 rounded-full" />
                            </motion.div>
                        ))}
                    </div>
                </div>
                <div className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-slate-950/90 via-slate-950/45 to-transparent z-20 pointer-events-none" />
                <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-slate-950/90 via-slate-950/45 to-transparent z-20 pointer-events-none" />
            </div>
        );
    }

    return (
        <div
            className={cn(
                "relative w-full h-[142px] rounded-2xl border border-cyan-400/15 overflow-hidden",
                isSpinning
                    ? "bg-[linear-gradient(180deg,rgba(8,26,40,0.92),rgba(2,12,22,0.94))]"
                    : "bg-[linear-gradient(180deg,rgba(8,26,40,0.84),rgba(2,12,22,0.9))] backdrop-blur-md"
            )}
        >
            {/* Scanner */}
            <div className="absolute left-1/2 top-0 bottom-0 w-[3px] bg-cyan-300 z-30 -translate-x-1/2 shadow-[0_0_18px_rgba(34,211,238,0.8),0_0_36px_rgba(34,211,238,0.35)]">
                <div className="absolute top-0 -left-[6px] w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-t-[10px] border-t-cyan-300" />
                <div className="absolute bottom-0 -left-[6px] w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-b-[10px] border-b-cyan-300" />
            </div>

            <div
                ref={containerRef}
                className="absolute inset-0 flex items-center"
                style={{
                    transform: "translate3d(0,0,0)",
                    backfaceVisibility: "hidden",
                    WebkitBackfaceVisibility: "hidden"
                }}
            >
                <motion.div
                    className="flex items-center transform-gpu"
                    style={{
                        x,
                        willChange: "transform",
                        backfaceVisibility: "hidden",
                        WebkitBackfaceVisibility: "hidden"
                    }}
                    animate={controls}
                >
                    {tape.map((player, i) => {
                        // Do not reveal winner during the spin; highlight only after spin stops.
                        const isWinnerCard = !isSpinning && i === WINNER_INDEX && player.id === winnerId;
                        return (
                        <div
                            key={`${player.id}-${i}`}
                            style={{
                                width: CARD_WIDTH,
                                marginRight: GAP
                            }}
                            className={cn(
                                "relative h-[104px] rounded-xl flex-shrink-0 flex flex-col items-center justify-center border overflow-hidden",
                                isWinnerCard
                                    ? "z-10 border-amber-300/60 bg-gradient-to-br from-amber-400/25 via-yellow-500/20 to-rose-400/15 shadow-[0_0_24px_rgba(251,191,36,0.35)]"
                                    : isSpinning
                                        ? "z-0 border-cyan-300/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.9),rgba(8,47,73,0.8))]"
                                        : "z-0 border-cyan-300/18 bg-gradient-to-br from-teal-800/45 via-cyan-900/30 to-teal-900/45 shadow-md"
                            )}
                        >
                            <div
                                className={cn("absolute inset-0", isSpinning ? "opacity-[0.12]" : "opacity-20")}
                                style={{ backgroundColor: player.color }}
                            />

                            <div
                                className={cn(
                                    "w-12 h-12 rounded-full border-2 overflow-hidden z-10 relative",
                                    !isSpinning && "shadow-lg transition-all duration-300"
                                )}
                                style={{
                                    borderColor: isWinnerCard ? "#fbbf24" : "#22d3ee",
                                    boxShadow: isWinnerCard
                                        ? "0 0 16px rgba(251,191,36,0.45)"
                                        : isSpinning
                                            ? "none"
                                            : "0 0 12px rgba(6,182,212,0.3)"
                                }}
                            >
                                <img src={player.avatarUrl} alt={player.name} className="w-full h-full object-cover" />
                            </div>

                            {!isSpinning && (
                                <div className="absolute top-1.5 right-1.5 bg-slate-900 border border-cyan-300/25 px-1.5 rounded text-[7px] font-mono text-cyan-200 shadow-sm">
                                    {player.chancePercent.toFixed(1)}%
                                </div>
                            )}
                        </div>
                    )})}
                </motion.div>
            </div>

            <div className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-slate-950/90 via-slate-950/45 to-transparent z-20" />
            <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-slate-950/90 via-slate-950/45 to-transparent z-20" />
        </div>
    );
}
