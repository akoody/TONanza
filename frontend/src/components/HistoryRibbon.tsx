import { motion } from "framer-motion";
import { formatNanotonsCompact } from "../lib/format";

export interface WinnerHistoryItem {
    id: string; // gameId
    username: string;
    payoutNanotons: bigint;
    avatarUrl?: string;
    timestamp: number;
}

interface HistoryRibbonProps {
    winners: WinnerHistoryItem[];
    onSelectGame?: (gameId: string) => void;
}

const formatGameNumber = (gameId: string): string => {
    const parsed = Number(gameId);
    if (!Number.isFinite(parsed) || parsed < 1) return gameId;
    return Math.trunc(parsed).toString();
};

export function HistoryRibbon({ winners, onSelectGame }: HistoryRibbonProps) {
    if (winners.length === 0) return null;

    return (
        <div className="px-3">
            <div className="w-full h-16 bg-black/20 backdrop-blur-md border-b border-white/5 flex items-center overflow-x-auto no-scrollbar px-3 space-x-3 snap-x snap-mandatory">
                {winners.map((winner, i) => (
                    <motion.div
                        key={`${winner.id}-${i}`}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                        onClick={() => onSelectGame?.(winner.id)}
                        className="snap-start flex-none flex items-center gap-2 bg-gradient-to-r from-teal-900/40 to-cyan-900/40 rounded-full pl-1.5 pr-4 py-1.5 border border-cyan-500/10 cursor-pointer active:scale-95 hover:border-cyan-400/30 transition-all group"
                    >
                        {/* Avatar */}
                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-teal-500 flex items-center justify-center text-[10px] font-bold text-white shadow-lg overflow-hidden group-hover:scale-110 transition-transform">
                            {winner.avatarUrl ? (
                                <img src={winner.avatarUrl} alt={winner.username} className="w-full h-full object-cover" />
                            ) : (
                                winner.username.slice(0, 1).toUpperCase()
                            )}
                        </div>

                        <div className="flex flex-col leading-none">
                            <span className="text-[9px] text-white/45 font-mono">
                                #{formatGameNumber(winner.id)}
                            </span>
                            <span className="text-[10px] text-cyan-200/70 font-bold truncate max-w-[70px] uppercase tracking-wide">
                                {winner.username}
                            </span>
                            <span className="text-xs font-black text-emerald-400 font-mono drop-shadow-[0_0_5px_rgba(52,211,153,0.4)]">
                                +{formatNanotonsCompact(winner.payoutNanotons)}
                            </span>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
