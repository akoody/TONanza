import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownToLine, ArrowUpFromLine, Clock3, FileText, History, Menu, Megaphone, Settings, Users, Vibrate, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GameHistoryEntry } from "./GameHistoryModal";
import { formatNanotonsBalance, formatNanotonsCompact } from "../lib/format";
import type { PaymentHistoryEntry } from "../lib/api";
import { parseSafeBigInt } from "../lib/security";

type MenuTab = "history" | "payments" | "settings";

interface MenuModalProps {
    isOpen: boolean;
    history: GameHistoryEntry[];
    payments: PaymentHistoryEntry[];
    isSoundEnabled: boolean;
    isHapticsEnabled: boolean;
    onToggleSound: () => void;
    onToggleHaptics: () => void;
    onSelectGame: (game: GameHistoryEntry) => void;
    onOpenReferrals: () => void;
    onOpenTerms: () => void;
    onOpenOfficialChannel: () => void;
    onClose: () => void;
}

const OVERLAY_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
const PANEL_TRANSITION = { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };

const formatGameTime = (timestamp: number) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
};

const formatEventTime = (timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
};

const formatWinnerChance = (game: GameHistoryEntry) => {
    if (!game.winnerId) return "—";

    const winner = game.players.find((player) => player.userId === game.winnerId);
    if (!winner) return "—";

    const totalByPlayers = game.players.reduce((acc, player) => acc + player.amountNanotons, 0n);
    if (totalByPlayers <= 0n) return "—";

    const chance = Number((winner.amountNanotons * 1000n) / totalByPlayers) / 10;
    return `${chance.toFixed(1)}%`;
};

const formatGameNumber = (gameId: string): string => {
    const parsed = Number(gameId);
    if (!Number.isFinite(parsed) || parsed < 1) return gameId;
    return Math.trunc(parsed).toString();
};

export function MenuModal({
    isOpen,
    history,
    payments,
    isSoundEnabled,
    isHapticsEnabled,
    onToggleSound,
    onToggleHaptics,
    onSelectGame,
    onOpenReferrals,
    onOpenTerms,
    onOpenOfficialChannel,
    onClose
}: MenuModalProps) {
    const [activeTab, setActiveTab] = useState<MenuTab>("history");
    const recentHistory = useMemo(() => history.slice(0, 30), [history]);
    const recentPayments = useMemo(() => payments.slice(0, 50), [payments]);

    useEffect(() => {
        if (isOpen) setActiveTab("history");
    }, [isOpen]);

    return (
        <AnimatePresence mode="wait" initial={false}>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={OVERLAY_TRANSITION}
                    className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-md p-4 flex items-start justify-end sm:items-center sm:justify-center"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 16, scale: 0.975 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.985 }}
                        transition={PANEL_TRANSITION}
                        className="mt-[calc(env(safe-area-inset-top,0px)+62px)] sm:mt-0 w-full max-w-md max-h-[78vh] rounded-2xl border border-cyan-400/20 bg-teal-950/95 shadow-[0_20px_80px_rgba(6,182,212,0.2)] overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                            <div className="flex items-center gap-2">
                                <Menu size={18} className="text-cyan-300" />
                                <h3 className="text-sm font-black uppercase tracking-widest text-white">Меню</h3>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-all duration-200 ease-out active:scale-95"
                                aria-label="Закрыть меню"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="flex gap-1.5 px-3 pt-3">
                            <button
                                onClick={() => setActiveTab("history")}
                                className={`flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all duration-200 ease-out active:scale-[0.985] ${activeTab === "history"
                                    ? "bg-cyan-500/20 border-cyan-400/50 text-cyan-100"
                                    : "bg-white/5 border-white/10 text-white/60 hover:text-white"
                                    }`}
                            >
                                <History size={14} />
                                История игр
                            </button>
                            <button
                                onClick={() => setActiveTab("payments")}
                                className={`flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all duration-200 ease-out active:scale-[0.985] ${activeTab === "payments"
                                    ? "bg-cyan-500/20 border-cyan-400/50 text-cyan-100"
                                    : "bg-white/5 border-white/10 text-white/60 hover:text-white"
                                    }`}
                            >
                                <ArrowDownToLine size={14} />
                                Платежи
                            </button>
                            <button
                                onClick={() => setActiveTab("settings")}
                                className={`w-10 shrink-0 inline-flex items-center justify-center py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all duration-200 ease-out active:scale-95 ${activeTab === "settings"
                                    ? "bg-cyan-500/20 border-cyan-400/50 text-cyan-100"
                                    : "bg-white/5 border-white/10 text-white/60 hover:text-white"
                                    }`}
                                aria-label="Настройки"
                                title="Настройки"
                            >
                                <Settings size={14} />
                                <span className="sr-only">Настройки</span>
                            </button>
                        </div>

                        <div className="px-3 pt-3 pb-1 flex justify-center">
                            <button
                                onClick={onOpenReferrals}
                                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-400/30 text-emerald-200 font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-emerald-500/30 hover:border-emerald-400/50 transition-all duration-200 ease-out active:scale-[0.99]"
                            >
                                <Users size={16} />
                                Реферальная система
                            </button>
                        </div>

                        <div className="px-3 pb-3 pt-2 overflow-y-auto max-h-[calc(78vh-160px)]">
                            {activeTab === "history" ? (
                                recentHistory.length > 0 ? (
                                    <div className="space-y-2">
                                        {recentHistory.map((game) => (
                                            <button
                                                key={game.gameId}
                                                onClick={() => onSelectGame(game)}
                                                className="w-full text-left p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-cyan-400/40 active:scale-[0.99] transition-all duration-200 ease-out"
                                            >
                                                <div className="mb-1 text-[11px] font-mono font-bold text-cyan-200/75">
                                                    Игра #{formatGameNumber(game.gameId)}
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-bold text-white truncate">
                                                            {game.winnerName}
                                                        </div>
                                                        <div className="text-[11px] text-cyan-200/70 mt-0.5">
                                                            Банк: {formatNanotonsCompact(game.totalPotNanotons)}
                                                        </div>
                                                    </div>
                                                    <div className="text-right flex-shrink-0">
                                                        <div className="text-sm font-black font-mono text-cyan-200">
                                                            {formatWinnerChance(game)}
                                                        </div>
                                                        <div className="text-[11px] text-white/50">
                                                            {game.players.length} игрок(а)
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/45">
                                                    <Clock3 size={12} />
                                                    {formatGameTime(game.timestamp)}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-10 text-center text-sm uppercase tracking-widest text-white/35">
                                        История пока пуста
                                    </div>
                                )
                            ) : activeTab === "payments" ? (
                                recentPayments.length > 0 ? (
                                    <div className="space-y-2">
                                        {recentPayments.map((entry) => {
                                            const isDeposit = entry.kind === "DEPOSIT";
                                            const amount = parseSafeBigInt(entry.amountNanotons);
                                            const statusLabelMap: Record<string, string> = {
                                                PENDING: "В обработке",
                                                PROCESSING: "В обработке",
                                                CONFIRMED: "Подтверждено",
                                                BROADCASTED: "Отправлено",
                                                COMPLETED: "Завершено",
                                                FAILED: "Ошибка"
                                            };
                                            const statusLabel = statusLabelMap[entry.status] ?? entry.status;

                                            return (
                                                <div
                                                    key={`${entry.kind}-${entry.id}`}
                                                    className="w-full text-left p-3 rounded-xl border border-white/10 bg-white/5"
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-bold text-white inline-flex items-center gap-1.5">
                                                                {isDeposit ? (
                                                                    <ArrowDownToLine size={14} className="text-emerald-300" />
                                                                ) : (
                                                                    <ArrowUpFromLine size={14} className="text-rose-300" />
                                                                )}
                                                                {isDeposit ? "Пополнение" : "Вывод"}
                                                            </div>
                                                            <div className="text-[11px] text-white/55 mt-0.5 truncate">
                                                                {statusLabel}
                                                            </div>
                                                            <div className="text-[11px] text-white/45 mt-0.5 font-mono">
                                                                ID: {entry.id}
                                                            </div>
                                                        </div>
                                                        <div className={`text-sm font-black font-mono ${isDeposit ? "text-emerald-300" : "text-rose-300"}`}>
                                                            {isDeposit ? "+" : "-"}{formatNanotonsBalance(amount)}
                                                        </div>
                                                    </div>
                                                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/45">
                                                        <Clock3 size={12} />
                                                        {formatEventTime(entry.createdAt)}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="py-10 text-center text-sm uppercase tracking-widest text-white/35">
                                        История платежей пуста
                                    </div>
                                )
                            ) : (
                                <div className="space-y-2">
                                    <button
                                        onClick={onToggleSound}
                                        className="w-full flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all duration-200 ease-out active:scale-[0.99]"
                                    >
                                        <div className="flex items-center gap-2">
                                            {isSoundEnabled ? <Volume2 size={16} className="text-cyan-300" /> : <VolumeX size={16} className="text-rose-300" />}
                                            <div className="text-left">
                                                <div className="text-sm font-bold text-white">Звук</div>
                                                <div className="text-[11px] text-white/45">Музыка и эффекты выигрыша</div>
                                            </div>
                                        </div>
                                        <span className={`text-xs font-bold uppercase ${isSoundEnabled ? "text-emerald-300" : "text-white/40"}`}>
                                            {isSoundEnabled ? "Вкл" : "Выкл"}
                                        </span>
                                    </button>

                                    <button
                                        onClick={onToggleHaptics}
                                        className="w-full flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all duration-200 ease-out active:scale-[0.99]"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Vibrate size={16} className={isHapticsEnabled ? "text-cyan-300" : "text-white/40"} />
                                            <div className="text-left">
                                                <div className="text-sm font-bold text-white">Вибрация</div>
                                                <div className="text-[11px] text-white/45">Haptic-отклик при действиях</div>
                                            </div>
                                        </div>
                                        <span className={`text-xs font-bold uppercase ${isHapticsEnabled ? "text-emerald-300" : "text-white/40"}`}>
                                            {isHapticsEnabled ? "Вкл" : "Выкл"}
                                        </span>
                                    </button>

                                    <button
                                        onClick={onOpenTerms}
                                        className="w-full flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all duration-200 ease-out active:scale-[0.99]"
                                    >
                                        <div className="flex items-center gap-2">
                                            <FileText size={16} className="text-cyan-300" />
                                            <div className="text-left">
                                                <div className="text-sm font-bold text-white">Условия использования</div>
                                                <div className="text-[11px] text-white/45">Правила доступа и использования TONanza</div>
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={onOpenOfficialChannel}
                                        className="w-full flex items-center justify-between p-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 hover:bg-cyan-500/15 transition-all duration-200 ease-out active:scale-[0.99]"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Megaphone size={16} className="text-cyan-200" />
                                            <div className="text-left">
                                                <div className="text-sm font-bold text-white">Официальный канал</div>
                                                <div className="text-[11px] text-cyan-100/70">@TONanzaNFT</div>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
