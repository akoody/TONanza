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

export function HistoryRibbon({ winners, onSelectGame }: HistoryRibbonProps) {
    if (winners.length === 0) return null;

    return (
        <div className="w-full h-14 bg-black/40 backdrop-blur-md border-b border-white/5 flex items-center overflow-x-auto no-scrollbar px-4 space-x-4">
            {winners.map((winner, i) => (
                <motion.div
                    key={winner.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    onClick={() => onSelectGame?.(winner.id)}
                    className="flex-none flex items-center space-x-2 bg-white/5 rounded-full pl-1 pr-3 py-1 border border-white/5 cursor-pointer active:scale-95 hover:bg-white/10 transition-all"
                >
                    {/* Avatar / Placeholder */}
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-brand-purple to-brand-gold flex items-center justify-center text-[10px] font-bold text-black overflow-hidden">
                        {winner.avatarUrl ? (
                            <img src={winner.avatarUrl} alt={winner.username} className="w-full h-full object-cover" />
                        ) : (
                            winner.username.slice(0, 1).toUpperCase()
                        )}
                    </div>

                    <div className="flex flex-col leading-none">
                        <span className="text-[10px] text-white/60 font-medium truncate max-w-[60px]">
                            {winner.username}
                        </span>
                        <span className="text-xs font-bold text-emerald-400 font-mono">
                            +{formatNanotonsCompact(winner.payoutNanotons)}
                        </span>
                    </div>
                </motion.div>
            ))}
        </div>
    );
}
