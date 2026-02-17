import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { formatNanotonsCompact } from "../lib/format";

export interface GameHistoryEntry {
    gameId: string;
    players: Array<{
        userId: string;
        name: string;
        amountNanotons: bigint;
        color: string;
    }>;
    winnerId: string | null;
    winnerName: string;
    totalPotNanotons: bigint;
    payoutNanotons: bigint;
    timestamp: number;
}

interface GameHistoryModalProps {
    game: GameHistoryEntry | null;
    onClose: () => void;
}

export function GameHistoryModal({ game, onClose }: GameHistoryModalProps) {
    if (!game) return null;

    const totalByPlayers = game.players.reduce((acc, p) => acc + p.amountNanotons, 0n);

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.95, y: 10 }}
                    className="bg-slate-900 border border-white/10 rounded-2xl max-w-sm w-full p-5 max-h-[80vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">Детали игры</h3>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-white/50 hover:text-white transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Winner Banner */}
                    <div className="bg-gradient-to-r from-brand-gold/10 to-brand-amber/10 border border-brand-gold/30 rounded-xl p-4 mb-4 text-center">
                        <div className="text-[10px] uppercase tracking-widest text-brand-gold/70 font-bold mb-1">
                            Победитель
                        </div>
                        <div className="text-xl font-black text-brand-gold">
                            {game.winnerName}
                        </div>
                        <div className="text-sm font-mono font-bold text-emerald-400 mt-1">
                            +{formatNanotonsCompact(game.payoutNanotons)}
                        </div>
                    </div>

                    {/* Pot Info */}
                    <div className="flex items-center justify-between text-xs text-white/50 mb-3 px-1">
                        <span>Общий банк</span>
                        <span className="font-mono font-bold text-white/80">
                            {formatNanotonsCompact(game.totalPotNanotons)}
                        </span>
                    </div>

                    {/* Players */}
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest px-1">
                            Участники ({game.players.length})
                        </div>
                        {game.players.map((player) => {
                            const chance = totalByPlayers > 0n
                                ? Number((player.amountNanotons * 1000n) / totalByPlayers) / 10
                                : 0;
                            const isWinner = player.userId === game.winnerId;
                            return (
                                <div
                                    key={player.userId}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${isWinner
                                        ? "bg-brand-gold/10 border-brand-gold/30"
                                        : "bg-white/5 border-white/5"
                                        }`}
                                >
                                    <div
                                        className="w-3 h-3 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: player.color }}
                                    />
                                    <span className={`text-xs font-bold truncate flex-1 ${isWinner ? "text-brand-gold" : "text-white/80"}`}>
                                        {player.name}
                                        {isWinner && " 👑"}
                                    </span>
                                    <span className="text-[10px] font-mono text-white/50 flex-shrink-0">
                                        {formatNanotonsCompact(player.amountNanotons)}
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-white/60 w-10 text-right flex-shrink-0">
                                        {chance.toFixed(1)}%
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-sm transition-colors text-white"
                    >
                        Закрыть
                    </button>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
