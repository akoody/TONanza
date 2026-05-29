import { memo, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatNanotonsCompact } from "../lib/format";
import { cn } from "../lib/utils";
import type { LiveEvent } from "../types";

interface BetListProps {
    events: LiveEvent[];
}

type BetRarity = "blue" | "purple" | "red" | "gold";

const BLUE_MAX_NANOTONS = 5_000_000_000n; // 5 TON
const PURPLE_MAX_NANOTONS = 20_000_000_000n; // 20 TON
const RED_MAX_NANOTONS = 100_000_000_000n; // 100 TON

const getBetRarity = (amount: bigint): BetRarity => {
    if (amount <= BLUE_MAX_NANOTONS) return "blue";
    if (amount <= PURPLE_MAX_NANOTONS) return "purple";
    if (amount <= RED_MAX_NANOTONS) return "red";
    return "gold";
};

const RARITY_UI: Record<BetRarity, {
    cardClass: string;
}> = {
    blue: {
        cardClass: "bg-[linear-gradient(110deg,#1e3a8a_0%,#1d4ed8_52%,#0f766e_100%)] border-blue-200/65 shadow-[0_0_16px_rgba(37,99,235,0.3)]"
    },
    purple: {
        cardClass: "bg-[linear-gradient(110deg,#3b0764_0%,#6d28d9_52%,#9333ea_100%)] border-violet-200/65 shadow-[0_0_16px_rgba(139,92,246,0.32)]"
    },
    red: {
        cardClass: "bg-[linear-gradient(110deg,#7f1d1d_0%,#b91c1c_52%,#e11d48_100%)] border-rose-200/65 shadow-[0_0_16px_rgba(239,68,68,0.34)]"
    },
    gold: {
        cardClass: "bg-[linear-gradient(110deg,#78350f_0%,#d97706_52%,#eab308_100%)] border-amber-100/68 shadow-[0_0_18px_rgba(245,158,11,0.36)]"
    }
};

export const BetList = memo(function BetList({ events }: BetListProps) {
    const bets = useMemo(
        () => events.filter((e) => e.type === "bet" || e.type === "win"),
        [events]
    );

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
                    const rarity = getBetRarity(amountBig > 0n ? amountBig : 1n);
                    const rarityUi = RARITY_UI[rarity];
                    const isUser = event.data?.isUser;
                    const isGoldRarity = rarity === "gold";

                    return (
                        <motion.div
                            key={event.id}
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.16, ease: "easeOut" }}
                            className={cn(
                                "relative flex items-center justify-between p-3 rounded-xl border transition-all",
                                rarityUi.cardClass,
                                isUser && "ring-1 ring-cyan-200/45"
                            )}
                        >
                            {isGoldRarity && (
                                <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                    <motion.div
                                        className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-300/12 to-transparent"
                                        animate={{ x: [-300, 300] }}
                                        transition={{ repeat: Infinity, duration: 2.3, ease: "linear" }}
                                    />
                                </div>
                            )}

                            <div className="flex items-center gap-3 z-10">
                                {/* Avatar */}
                                <div className={cn(
                                    "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm relative shadow-lg overflow-hidden",
                                    "bg-slate-900/90 text-white border border-white/20"
                                )}>
                                    {event.data?.avatarUrl ? (
                                        <img src={event.data.avatarUrl} alt={event.data.username} className="w-full h-full object-cover" />
                                    ) : (
                                        <>
                                            {event.data?.username?.slice(0, 2).toUpperCase() || "??"}
                                        </>
                                    )}
                                </div>

                                <div className="flex flex-col justify-center">
                                    <span className={cn(
                                        "font-bold text-sm tracking-tight",
                                        "text-white/92"
                                    )}>
                                        {event.data?.username || "Unknown"}
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-col items-end z-10">
                                <span className={cn(
                                    "font-mono font-black text-lg",
                                    "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]"
                                )}>
                                    {amountBig > 0n ? formatNanotonsCompact(amountBig) : "---"}
                                </span>
                                <div className="mt-0.5 flex items-center gap-1">
                                    {event.type === "win" && (
                                        <span className="text-[9px] font-black text-black uppercase bg-gradient-to-r from-emerald-400 to-teal-400 px-2 py-0.5 rounded shadow-[0_0_10px_rgba(52,211,153,0.4)]">
                                            Win
                                        </span>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
});
