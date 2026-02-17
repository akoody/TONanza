import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import type { PlayerChance } from "../types";

interface ParticipantsListProps {
    players: PlayerChance[];
    totalPotNanotons: bigint;
}

export function ParticipantsList({ players, totalPotNanotons }: ParticipantsListProps) {
    if (players.length === 0) return null;

    return (
        <div className="w-full px-4 pt-4 pb-2">
            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                <span>Участники</span>
                <span className="bg-white/10 text-white px-1.5 py-0.5 rounded text-[10px]">{players.length}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {players.map((player, index) => {
                    const chance = totalPotNanotons > 0n
                        ? Number((player.amountNanotons * 10000n) / totalPotNanotons) / 100
                        : 0;

                    const isTop = index === 0 && players.length > 1;

                    return (
                        <motion.div
                            key={player.userId}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className={cn(
                                "relative flex items-center justify-between p-3 rounded-xl border backdrop-blur-sm overflow-hidden",
                                isTop
                                    ? "bg-gradient-to-r from-brand-gold/10 to-brand-gold/5 border-brand-gold/30 shadow-[0_0_15px_rgba(255,215,0,0.1)]"
                                    : "bg-white/5 border-white/5"
                            )}
                        >
                            {/* Color Bar */}
                            <div
                                className="absolute left-0 top-0 bottom-0 w-1"
                                style={{ backgroundColor: player.color }}
                            />

                            <div className="flex items-center gap-3 pl-2">
                                {/* Avatar */}
                                <div className="w-8 h-8 rounded-full bg-black/40 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                    <div
                                        className="w-full h-full opacity-80"
                                        style={{ backgroundColor: player.color }}
                                    />
                                    <div className="absolute text-[10px] font-bold text-white/50">
                                        {player.name.slice(0, 1)}
                                    </div>
                                </div>

                                <div className="flex flex-col overflow-hidden">
                                    <span className={cn(
                                        "text-xs font-bold truncate max-w-[80px]",
                                        isTop ? "text-brand-gold" : "text-white"
                                    )}>
                                        {player.name}
                                    </span>
                                </div>
                            </div>

                            {/* Win Chance Circle */}
                            <div className="flex flex-col items-end">
                                <div className={cn(
                                    "text-sm font-black font-mono",
                                    isTop ? "text-brand-gold" : "text-white/80"
                                )}>
                                    {chance.toFixed(1)}%
                                </div>
                            </div>
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
}
