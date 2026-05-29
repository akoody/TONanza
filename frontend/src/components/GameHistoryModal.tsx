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

const OVERLAY_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
const PANEL_TRANSITION = { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };

const formatGameNumber = (gameId: string): string => {
    const parsed = Number(gameId);
    if (!Number.isFinite(parsed) || parsed < 1) return gameId;
    return Math.trunc(parsed).toString();
};

export function GameHistoryModal({ game, onClose }: GameHistoryModalProps) {
    const totalByPlayers = game ? game.players.reduce((acc, p) => acc + p.amountNanotons, 0n) : 0n;
    const playedAtLabel = game
        ? (() => {
            const playedAt = new Date(game.timestamp);
            return Number.isNaN(playedAt.getTime())
                ? "—"
                : playedAt.toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                });
        })()
        : "—";

    return (
        <AnimatePresence mode="wait" initial={false}>
            {game && (
                <motion.div
                    key={game.gameId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={OVERLAY_TRANSITION}
                    className="fixed inset-0 z-[95] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.975, y: 16, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        exit={{ scale: 0.985, y: 12, opacity: 0 }}
                        transition={PANEL_TRANSITION}
                        className="bg-teal-950 border border-cyan-500/20 rounded-2xl max-w-sm w-full p-5 max-h-[80vh] overflow-y-auto shadow-2xl shadow-cyan-900/50"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-white">Детали игры</h3>
                            <button
                                onClick={onClose}
                                className="p-1.5 text-white/50 hover:text-white transition-all duration-200 ease-out active:scale-95"
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
                            <span>Номер игры</span>
                            <span className="font-mono font-bold text-white/80">
                                #{formatGameNumber(game.gameId)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-white/50 mb-3 px-1">
                            <span>Общий банк</span>
                            <span className="font-mono font-bold text-white/80">
                                {formatNanotonsCompact(game.totalPotNanotons)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-white/50 mb-4 px-1">
                            <span>Время раунда</span>
                            <span className="font-mono font-bold text-white/80">
                                {playedAtLabel}
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
                            className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-sm transition-all duration-200 ease-out active:scale-[0.99] text-white"
                        >
                            Закрыть
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
