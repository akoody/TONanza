import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import type { PlayerChance } from "../types";
import { formatNanotonsCompact } from "../lib/format";

interface ParticipantsListProps {
    players: PlayerChance[];
    totalPotNanotons: bigint;
    currentUserId?: string;
}

export function ParticipantsList({ players, totalPotNanotons, currentUserId }: ParticipantsListProps) {
    if (players.length === 0) return null;

    return (
        <div className="w-full px-4 pt-4 pb-2">
            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-3 pl-1 flex items-center gap-2">
                <span>Участники</span>
                <span className="bg-white/10 text-white px-1.5 py-0.5 rounded text-[10px]">{players.length}</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
                {players.map((player, index) => {
                    const chance = totalPotNanotons > 0n
                        ? Number((player.amountNanotons * 1000n) / totalPotNanotons) / 10
                        : 0;

                    const isCurrentUser = Boolean(currentUserId) && player.userId === currentUserId;

                    return (
                        <motion.div
                            key={player.userId}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.03 }}
                            className={cn(
                                "relative flex flex-col items-center justify-center p-2 rounded-xl border backdrop-blur-sm overflow-hidden text-center gap-1",
                                "bg-white/5 border-white/5",
                                isCurrentUser && "ring-1 ring-white/80 border-white/80 shadow-[0_0_14px_rgba(255,255,255,0.45)] z-10"
                            )}
                        >
                            {/* Color Bar / Indicator */}
                            <div
                                className="absolute top-0 inset-x-0 h-[2.8px] opacity-50"
                                style={{ backgroundColor: player.color }}
                            />

                            {/* Avatar */}
                            <div className="w-10 h-10 rounded-full bg-black/40 border border-white/10 flex items-center justify-center overflow-hidden shrink-0 shadow-lg mb-0.5">
                                {player.avatarUrl ? (
                                    <img src={player.avatarUrl} alt={player.name} className="w-full h-full object-cover" />
                                ) : (
                                    <span className="font-bold text-white/50 text-xs">
                                        {player.name.slice(0, 1)}
                                    </span>
                                )}
                            </div>
                            {/* Chance */}
                            <div className="text-sm font-black font-mono leading-none text-white">
                                {chance.toFixed(1)}%
                            </div>

                            {/* Amount */}
                            <div className="text-[10px] font-bold text-white/60 bg-white/5 px-1.5 py-0.5 rounded-md">
                                {formatNanotonsCompact(player.amountNanotons)}
                            </div>
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
}
