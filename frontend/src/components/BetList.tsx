import { AnimatePresence, motion } from "framer-motion";
import { formatNanotonsCompact } from "../lib/format";
import { cn } from "../lib/utils";
import type { LiveEvent } from "../types";

interface BetListProps {
    events: LiveEvent[];
}

const WHALE_THRESHOLD = 10_000_000_000n; // 10 TON

export function BetList({ events }: BetListProps) {
    const bets = events.filter(e => e.type === "bet" || e.type === "win");

    if (bets.length === 0) {
        return (
            <div className="text-center py-10 opacity-30 text-sm font-mono uppercase tracking-widest">
                Ставок пока нет
            </div>
        );
    }

    return (
        <div className="flex flex-col space-y-2 pb-4">
            <div className="text-xs font-bold text-white/30 uppercase tracking-widest pl-2 mb-2">
                Ставки ({bets.length})
            </div>

            <AnimatePresence initial={false}>
                {bets.map((event) => {
                    const amountBig = event.data?.amountNanotons ? BigInt(event.data.amountNanotons) : 0n;
                    const isWhale = amountBig >= WHALE_THRESHOLD;
                    const isUser = event.data?.isUser;

                    return (
                        <motion.div
                            key={event.id}
                            layout
                            initial={{ opacity: 0, y: -20, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                            className={cn(
                                "relative flex items-center justify-between p-3 rounded-xl border transition-all",
                                isUser
                                    ? "bg-brand-purple/10 border-brand-purple/40"
                                    : isWhale
                                        ? "bg-gradient-to-r from-brand-gold/15 to-brand-gold/5 border-brand-gold/50 shadow-[0_0_20px_rgba(255,215,0,0.15)]"
                                        : "bg-surface border-white/5"
                            )}
                        >
                            {/* Whale shimmer overlay */}
                            {isWhale && (
                                <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                    <motion.div
                                        className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-gold/10 to-transparent"
                                        animate={{ x: [-300, 300] }}
                                        transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }}
                                    />
                                </div>
                            )}

                            <div className="flex items-center gap-3 z-10">
                                {/* Avatar */}
                                <div className={cn(
                                    "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm relative",
                                    isWhale ? "bg-gradient-gold text-black" : "bg-white/10 text-white/60"
                                )}>
                                    {event.data?.username?.slice(0, 2).toUpperCase() || "??"}
                                    {isWhale && (
                                        <span className="absolute -top-1 -right-1 text-xs">💎</span>
                                    )}
                                </div>

                                <div className="flex flex-col">
                                    <span className={cn(
                                        "font-bold text-sm",
                                        isWhale ? "text-brand-gold" : "text-white"
                                    )}>
                                        {event.data?.username || "Unknown"}
                                    </span>
                                    <span className="text-[10px] text-white/40 uppercase tracking-wide">
                                        {isUser ? "Вы" : isWhale ? "Кит 🐋" : "Игрок"}
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-col items-end z-10">
                                <span className={cn(
                                    "font-mono font-black text-lg",
                                    isWhale ? "text-brand-gold drop-shadow-[0_0_8px_rgba(255,215,0,0.5)]" : "text-white"
                                )}>
                                    {amountBig > 0n ? formatNanotonsCompact(amountBig) : "---"}
                                </span>
                                {event.type === "win" && (
                                    <span className="text-[10px] font-bold text-emerald-400 uppercase bg-emerald-400/10 px-1.5 py-0.5 rounded">
                                        ПОБЕДИТЕЛЬ
                                    </span>
                                )}
                            </div>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
