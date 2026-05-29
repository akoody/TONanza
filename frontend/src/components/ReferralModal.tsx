import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Copy, Gift, Info, Percent, Users, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { claimReferralBalance, getReferralInfo, type ReferralInfoResponse } from "../lib/api";
import { formatNanotonsForInput } from "../lib/format";
import { parseSafeBigInt } from "../lib/security";
import { useToast } from "./ui/Toast";

interface ReferralModalProps {
    isOpen: boolean;
    onClose: () => void;
    telegramId: string;
    onBalanceRefresh: () => Promise<void>;
}

const OVERLAY_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
const PANEL_TRANSITION = { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };
const INNER_TRANSITION = { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };

export function ReferralModal({ isOpen, onClose, telegramId, onBalanceRefresh }: ReferralModalProps) {
    const [info, setInfo] = useState<ReferralInfoResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isClaiming, setIsClaiming] = useState(false);
    const [showInfoView, setShowInfoView] = useState(false);
    const { toast } = useToast();

    const referralLink = `https://t.me/tonanza_bot/app?startapp=ref_${telegramId}`;

    useEffect(() => {
        if (isOpen) {
            loadInfo();
            setShowInfoView(false);
        }
    }, [isOpen]);

    const loadInfo = async () => {
        setIsLoading(true);
        try {
            const data = await getReferralInfo();
            setInfo(data);
        } catch (e) {
            console.error("Failed to load referral info:", e);
            toast("Не удалось загрузить данные", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(referralLink);
            toast("Ссылка скопирована!", "success");
        } catch {
            toast("Ошибка при копировании", "error");
        }
    };

    const handleClaim = async () => {
        if (isClaiming) return;
        setIsClaiming(true);
        try {
            await claimReferralBalance();
            toast("Реферальные успешно зачислены!", "success");
            await loadInfo();
            await onBalanceRefresh();
            // Optionally close or just stay open.
        } catch (e: any) {
            toast(e.message || "Не удалось забрать реферальные", "error");
        } finally {
            setIsClaiming(false);
        }
    };

    const balanceNanotons = info ? parseSafeBigInt(info.referralBalanceNanotons) : 0n;
    const canClaim = balanceNanotons > 0n;
    const referralSharePercent = info?.tierPercentage ?? 0;
    const hasReferrer = info?.hasReferrer ?? false;
    const selfBetShareLabel = hasReferrer
        ? `${info?.selfBetRakebackMinPercentage ?? 2}\u2011${info?.selfBetRakebackMaxPercentage ?? 5}%`
        : "0%";
    const referredByLabel = info?.referredBy
        ? info.referredBy.username
            ? `@${info.referredBy.username} (ID ${info.referredBy.telegramId})`
            : `ID ${info.referredBy.telegramId}`
        : "Вы зашли без реферальной ссылки";

    return (
        <AnimatePresence mode="wait" initial={false}>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={OVERLAY_TRANSITION}
                    className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md p-4 flex items-center justify-center"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.975, y: 18 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.985, y: 14 }}
                        transition={PANEL_TRANSITION}
                        className="w-full max-w-sm rounded-[2rem] bg-teal-950/95 backdrop-blur-xl border border-cyan-400/20 shadow-[0_20px_80px_rgba(6,182,212,0.2)] overflow-hidden relative"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10 bg-black/20">
                            <div className="flex items-center gap-2">
                                {showInfoView ? (
                                    <button
                                        onClick={() => setShowInfoView(false)}
                                        className="p-1.5 -ml-1.5 rounded-lg text-cyan-300 hover:bg-cyan-500/20 transition-all duration-200 ease-out active:scale-95"
                                    >
                                        <ChevronLeft size={20} />
                                    </button>
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-300">
                                        <Users size={16} />
                                    </div>
                                )}
                                <h3 className="text-sm font-black uppercase tracking-widest text-white mt-0.5">
                                    {showInfoView ? "О системе" : "Рефералы"}
                                </h3>
                            </div>
                            <div className="flex items-center gap-1.5">
                                {!showInfoView && (
                                    <button
                                        onClick={() => setShowInfoView(true)}
                                        className="p-1.5 rounded-lg text-cyan-300/80 hover:text-cyan-300 hover:bg-cyan-500/20 transition-all duration-200 ease-out active:scale-95 bg-white/5"
                                        title="Как это работает?"
                                    >
                                        <Info size={16} />
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all duration-200 ease-out active:scale-95"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="relative overflow-hidden">
                            <AnimatePresence mode="wait">
                                {showInfoView ? (
                                    <motion.div
                                        key="info"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        transition={INNER_TRANSITION}
                                        className="p-5 space-y-4 text-sm text-cyan-100/80 overflow-y-auto max-h-[60vh] no-scrollbar"
                                    >
                                        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                                            <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                                                <Users size={16} className="text-cyan-400" />
                                                Как это работает?
                                            </h4>
                                            <p className="text-xs leading-relaxed opacity-80">
                                                Приглашайте друзей по вашей уникальной ссылке. Вы будете получать щедрый процент от комиссии платформы (комиссия платформы - 4%) с <b>каждой</b> их ставки в игре. Вознаграждения начисляются после завершения раунда и доступны к переводу на баланс в любой момент.
                                            </p>
                                        </div>

                                        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                                            <h4 className="font-bold text-white mb-3 flex items-center gap-2">
                                                <Percent size={16} className="text-emerald-400" />
                                                Твой уровень
                                            </h4>
                                            <p className="text-xs leading-relaxed opacity-80 mb-3">
                                                Чем больше друзей вы пригласите, тем выше ваш процент (от комиссии платформы 4%):
                                            </p>
                                            <div className="space-y-2 text-xs font-mono">
                                                <div className="flex justify-between items-center bg-black/20 p-2 rounded-lg">
                                                    <span>1 - 5 друзей</span>
                                                    <span className="text-emerald-400 font-bold">15%</span>
                                                </div>
                                                <div className="flex justify-between items-center bg-black/20 p-2 rounded-lg">
                                                    <span>6 - 25 друзей</span>
                                                    <span className="text-emerald-400 font-bold">20%</span>
                                                </div>
                                                <div className="flex justify-between items-center bg-black/20 p-2 rounded-lg">
                                                    <span>26 - 100 друзей</span>
                                                    <span className="text-emerald-400 font-bold">25%</span>
                                                </div>
                                                <div className="flex justify-between items-center bg-black/20 p-2 rounded-lg">
                                                    <span>101+ друзей</span>
                                                    <span className="text-emerald-400 font-bold text-sm">30%</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                                            <h4 className="font-bold text-white mb-2 flex items-center gap-2">
                                                <Wallet size={16} className="text-rose-400" />
                                                Кэшбек от своих ставок
                                            </h4>
                                            <p className="text-[11px] leading-relaxed text-rose-300 mb-2 italic">
                                                (работает только для тех, кто изначально пришел по чьей-либо ссылке)
                                            </p>
                                            <p className="text-xs leading-relaxed opacity-80 mb-3">
                                                Когда вы делаете ставки в играх, вы стабильно получаете часть от комиссии платформы (комиссия платформы - 4%) <b>обратно</b>, в зависимости от размера вашей ставки:
                                            </p>
                                            <div className="space-y-2 text-xs font-mono">
                                                <div className="flex justify-between items-center bg-black/20 p-2 rounded-lg">
                                                    <span>До 10 TON</span>
                                                    <span className="text-rose-400 font-bold">2%</span>
                                                </div>
                                                <div className="flex justify-between items-center bg-black/20 p-2 rounded-lg">
                                                    <span>10 - 50 TON</span>
                                                    <span className="text-rose-400 font-bold">3%</span>
                                                </div>
                                                <div className="flex justify-between items-center bg-black/20 p-2 rounded-lg">
                                                    <span>50 - 200 TON</span>
                                                    <span className="text-rose-400 font-bold">4%</span>
                                                </div>
                                                <div className="flex justify-between items-center bg-black/20 p-2 rounded-lg">
                                                    <span>От 200 TON</span>
                                                    <span className="text-rose-400 font-bold">5%</span>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="main"
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        transition={INNER_TRANSITION}
                                        className="p-5 space-y-5"
                                    >
                                        {/* Stats */}
                                        <div className="flex gap-3">
                                            <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center relative overflow-hidden">
                                                <div className="text-2xl font-black text-white drop-shadow-sm mb-1">
                                                    {isLoading ? "-" : info?.referralsCount || 0}
                                                </div>
                                                <div className="text-[10px] text-cyan-200/60 uppercase font-bold tracking-widest text-center">
                                                    Друзей
                                                </div>
                                            </div>
                                            <div className="flex-1 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-400/20 rounded-2xl p-4 flex flex-col items-center justify-center relative overflow-hidden">
                                                <div className="text-[10px] text-emerald-200/60 uppercase font-bold tracking-widest text-center mb-2">
                                                    Ваша доля
                                                </div>
                                                <div className="w-full space-y-1.5">
                                                    <div className="flex items-center justify-between gap-2 text-[11px] bg-black/20 rounded-lg px-2 py-1">
                                                        <span className="text-white/60">От рефералов</span>
                                                        <span className="font-black text-emerald-300 whitespace-nowrap shrink-0 text-right">
                                                            {isLoading ? "-" : `${referralSharePercent}%`}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-2 text-[11px] bg-black/20 rounded-lg px-2 py-1">
                                                        <span className="text-white/60">От своих ставок</span>
                                                        <span className="font-black text-emerald-300 whitespace-nowrap shrink-0 text-right">
                                                            {isLoading ? "-" : selfBetShareLabel}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Balance Claim */}
                                        <div className="bg-gradient-to-br from-teal-900/50 to-slate-900 rounded-2xl p-5 border border-cyan-400/20 shadow-inner relative overflow-hidden">
                                            <div className="absolute -right-10 -bottom-10 w-24 h-24 bg-cyan-500/20 rounded-full blur-2xl pointer-events-none" />
                                            <div className="flex justify-between items-start mb-1.5 relative z-10">
                                                <span className="text-[11px] font-bold text-cyan-200/50 uppercase tracking-widest flex items-center gap-1.5">
                                                    <Gift size={14} className="text-cyan-400" /> Заработано
                                                </span>
                                            </div>
                                            <div className="text-3xl font-black font-mono text-white drop-shadow-sm mb-4 relative z-10 flex items-center gap-2">
                                                {isLoading ? "..." : formatNanotonsForInput(balanceNanotons)} <span className="text-base text-cyan-400">TON</span>
                                            </div>
                                            <button
                                                onClick={handleClaim}
                                                disabled={!canClaim || isClaiming || isLoading}
                                                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500/80 to-teal-600/80 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] transition-all duration-200 ease-out text-white font-bold text-sm uppercase tracking-wider disabled:opacity-50 disabled:grayscale shadow-[0_0_20px_rgba(52,211,153,0.2)] border border-emerald-400/50 relative z-10"
                                            >
                                                {isClaiming ? "Перевод..." : "ПЕРЕВЕСТИ НА БАЛАНС"}
                                            </button>
                                        </div>

                                        {/* Referrer source */}
                                        <div className="space-y-2">
                                            <div className="text-[10px] font-bold text-cyan-200/50 uppercase tracking-widest px-1">Пригласивший</div>
                                            <div className="bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-xs font-mono text-cyan-100 shadow-inner">
                                                {isLoading ? "..." : referredByLabel}
                                            </div>
                                        </div>

                                        {/* Link */}
                                        <div className="space-y-2">
                                            <div className="text-[10px] font-bold text-cyan-200/50 uppercase tracking-widest px-1">Твоя реферальная ссылка</div>
                                            <div className="flex gap-2">
                                                <div className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-xs font-mono text-cyan-100 flex items-center shadow-inner select-all overflow-hidden">
                                                    <span className="truncate block w-full">
                                                        {referralLink}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={handleCopyLink}
                                                    className="w-12 h-12 flex-shrink-0 bg-cyan-500/20 hover:bg-cyan-500/30 rounded-xl flex items-center justify-center text-cyan-300 transition-all duration-200 ease-out border border-cyan-400/30 active:scale-95"
                                                    title="Скопировать"
                                                >
                                                    <Copy size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
