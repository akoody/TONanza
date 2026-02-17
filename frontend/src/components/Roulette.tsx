import { motion, useAnimation, useMotionValue, useSpring } from "framer-motion";
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
    onFinish: () => void;
}

const CARD_WIDTH = 140;
const GAP = 8;
const ITEM_SIZE = CARD_WIDTH + GAP;
const TAPE_LENGTH = 100;
const WINNER_INDEX = 85;

export function Roulette({ players, winnerId, isSpinning, spinKey, onFinish }: RouletteProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const controls = useAnimation();
    const x = useMotionValue(0);
    const hasStartedSpinRef = useRef(false);

    // Create a spring that follows x for blur calculation
    const xSpring = useSpring(x, { stiffness: 300, damping: 30 });
    const xVelocity = useMotionValue(0);

    useEffect(() => {
        return xSpring.on("change", (latest) => {
            const prev = x.getPrevious() || 0;
            const delta = Math.abs(latest - prev);
            xVelocity.set(delta);
        });
    }, [x, xSpring, xVelocity]);

    // Dynamic blur based on velocity
    // blurAmount removed — not used currently

    const [tape, setTape] = useState<RoulettePlayer[]>([]);

    // Build the tape when players change or a new spin is triggered
    useEffect(() => {
        if (players.length === 0) return;

        // Shuffle-like pattern: fill tape from players
        const newTape = Array.from({ length: TAPE_LENGTH }).map((_, i) => {
            return players[i % players.length];
        });

        // Shuffle the tape a bit for visual variety (but keep WINNER_INDEX available)
        for (let i = newTape.length - 1; i > 0; i--) {
            if (i === WINNER_INDEX) continue; // Don't touch winner slot
            const j = Math.floor(Math.random() * i);
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
    }, [players, winnerId, spinKey]);

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

                    // Random offset within the card for realism
                    const safeZone = (CARD_WIDTH / 2) - 15;
                    const randomOffset = Math.floor(Math.random() * (safeZone * 2)) - safeZone;

                    const targetX = baseTarget + randomOffset;

                    // Animate with 10 seconds duration + extreme deceleration curve
                    controls.start({
                        x: targetX,
                        transition: {
                            duration: 10,
                            ease: [0.05, 0.7, 0.1, 1.0], // Extreme "crawl" at the end
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
    }, [isSpinning, winnerId, spinKey, controls, onFinish, x]);

    // Empty state: decorative roulette with sectors
    const PLACEHOLDER_COLORS = [
        "#06b6d4", "#F700FF", "#FFD700", "#22c55e",
        "#6366f1", "#fb7185", "#FFAA00", "#14b8a6"
    ];

    if (players.length === 0) {
        return (
            <div className="relative w-full h-[180px] bg-gradient-to-r from-teal-950/40 via-cyan-900/30 to-teal-950/40 backdrop-blur-md border-y border-cyan-400/10 overflow-hidden flex flex-col justify-center">

                {/* Laser Scanner — dimmed for empty */}
                <div className="absolute left-1/2 top-0 bottom-0 w-[3px] bg-cyan-400/30 z-30 -translate-x-1/2 shadow-[0_0_15px_rgba(6,182,212,0.3),0_0_30px_rgba(6,182,212,0.15)]">
                    <div className="absolute top-0 -left-[6px] w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-t-[10px] border-t-cyan-400/40" />
                    <div className="absolute bottom-0 -left-[6px] w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-b-[10px] border-b-cyan-400/40" />
                </div>

                {/* Placeholder cards */}
                <div
                    className="w-full relative h-[140px]"
                    style={{
                        maskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)',
                        WebkitMaskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)'
                    }}
                >
                    <div className="absolute top-0 left-0 flex items-center h-full">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <motion.div
                                key={`placeholder-${i}`}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: i * 0.05, duration: 0.3 }}
                                style={{
                                    width: CARD_WIDTH,
                                    marginRight: GAP,
                                }}
                                className="relative h-[120px] rounded-xl flex-shrink-0 flex flex-col items-center justify-center border-2 border-cyan-400/10 bg-gradient-to-b from-teal-900/30 to-cyan-950/30 backdrop-blur-md overflow-hidden"
                            >
                                {/* Color accent */}
                                <div
                                    className="absolute inset-0 opacity-10"
                                    style={{ backgroundColor: PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length] }}
                                />

                                {/* Shimmer effect */}
                                <div className="absolute inset-0 overflow-hidden">
                                    <motion.div
                                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                                        animate={{ x: [-200, 200] }}
                                        transition={{
                                            repeat: Infinity,
                                            duration: 2,
                                            delay: i * 0.15,
                                            ease: "linear"
                                        }}
                                    />
                                </div>

                                {/* Placeholder circle */}
                                <div className="w-16 h-16 rounded-full border-2 border-white/10 mb-2 flex items-center justify-center">
                                    <div
                                        className="w-8 h-8 rounded-full opacity-30"
                                        style={{ backgroundColor: PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length] }}
                                    />
                                </div>

                                {/* Placeholder text */}
                                <div className="w-16 h-2 bg-white/5 rounded-full" />
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="relative w-full h-[180px] bg-gradient-to-r from-teal-950/40 via-cyan-900/30 to-teal-950/40 backdrop-blur-md border-y border-cyan-400/10 overflow-hidden flex flex-col justify-center">
            {/* Laser Scanner — bright neon */}
            <div className="absolute left-1/2 top-0 bottom-0 w-[4px] bg-cyan-400 z-30 -translate-x-1/2 shadow-[0_0_20px_rgba(6,182,212,0.8),0_0_40px_rgba(6,182,212,0.6),0_0_60px_rgba(6,182,212,0.4)]">
                <div className="absolute top-0 -left-[7px] w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[12px] border-t-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                <div className="absolute bottom-0 -left-[7px] w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[12px] border-b-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
            </div>

            {/* Track Container - With Fade Mask */}
            <div
                ref={containerRef}
                className="w-full relative h-[140px]"
                style={{
                    maskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)',
                    WebkitMaskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)'
                }}
            >
                <motion.div
                    className="absolute top-0 left-0 flex items-center h-full"
                    style={{ x }}
                    animate={controls}
                >
                    {tape.map((player, i) => (
                        <motion.div
                            key={`${player.id}-${i}-${spinKey}`}
                            style={{
                                width: CARD_WIDTH,
                                marginRight: GAP,
                            }}
                            className={cn(
                                "relative h-[120px] rounded-xl flex-shrink-0 flex flex-col items-center justify-center border-2 overflow-hidden shadow-lg backdrop-blur-md transition-all duration-300",
                                player.id === winnerId && isSpinning
                                    ? "z-10 border-amber-400/50 bg-gradient-to-br from-amber-500/25 via-yellow-600/20 to-rose-500/15 shadow-2xl shadow-amber-500/50"
                                    : "z-0 border-cyan-400/20 bg-gradient-to-br from-teal-800/50 via-cyan-900/40 to-teal-900/50 hover:border-cyan-400/40 hover:shadow-cyan-500/30"
                            )}
                        >
                            {/* Card Border Color based on player */}
                            <div
                                className="absolute inset-0 opacity-20"
                                style={{ backgroundColor: player.color }}
                            />

                            {/* Avatar */}
                            <div
                                className="w-16 h-16 rounded-full border-4 overflow-hidden shadow-xl mb-2 z-10 relative transition-all duration-300"
                                style={{
                                    borderColor: player.id === winnerId && isSpinning ? '#fbbf24' : '#22d3ee',
                                    boxShadow: player.id === winnerId && isSpinning
                                        ? '0 0 20px rgba(251, 191, 36, 0.5)'
                                        : '0 0 15px rgba(6, 182, 212, 0.3)'
                                }}
                            >
                                <img src={player.avatarUrl} alt={player.name} className="w-full h-full object-cover" />
                            </div>

                            {/* Name */}
                            <div className="text-[10px] uppercase font-bold text-white/80 z-10 truncate max-w-[90%]">
                                {player.name}
                            </div>

                            {/* Chance Badge */}
                            <div className="absolute top-2 right-2 bg-cyan-950/80 backdrop-blur-sm border border-cyan-400/20 px-1.5 rounded text-[8px] font-mono text-cyan-300 shadow-lg">
                                {player.chancePercent.toFixed(1)}%
                            </div>
                        </motion.div>
                    ))}
                </motion.div>
            </div>

            {/* Gradients to fade edges — wider for depth */}
            <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background via-background/60 to-transparent z-20" />
            <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background via-background/60 to-transparent z-20" />
        </div>
    );
}
