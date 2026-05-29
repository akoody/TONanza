import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { parseTonInputToNanotons, formatNanotonsForInput } from "../lib/format";
import { cn } from "../lib/utils";
import { hapticImpactMedium, hapticSelectionChanged } from "../lib/telegram";
import { soundEngine } from "../lib/audio";

interface BettingDockProps {
    balanceNanotons: bigint;
    isSubmitting: boolean;
    isCancelling?: boolean;
    disabled?: boolean;
    canCancelBet?: boolean;
    onPlaceBet: (amount: bigint) => void;
    onCancelBet?: () => void;
}

const PRESETS = [1];
const MIN_BET_NANOTONS = 100_000_000n;
const MIN_BET_TON_LABEL = "0.1";

export function BettingDock({
    balanceNanotons,
    isSubmitting,
    isCancelling = false,
    disabled,
    canCancelBet = false,
    onPlaceBet,
    onCancelBet
}: BettingDockProps) {
    const [inputValue, setInputValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const isBusy = isSubmitting || isCancelling;

    useEffect(() => {
        if (!error) return;

        const timeoutId = window.setTimeout(() => {
            setError(null);
        }, 3000);

        return () => window.clearTimeout(timeoutId);
    }, [error]);

    const handlePreset = (amountTon: number) => {
        hapticSelectionChanged();
        soundEngine.playUiClick();
        const current = parseFloat(inputValue || "0");
        setInputValue((current + amountTon).toFixed(1).replace(/\.0$/, ""));
        setError(null);
    };

    const handleMax = () => {
        hapticSelectionChanged();
        soundEngine.playUiClick();
        setInputValue(formatNanotonsForInput(balanceNanotons, 2));
        setError(null);
    };

    const handleClear = () => {
        hapticSelectionChanged();
        soundEngine.playUiClick();
        setInputValue("");
        setError(null);
    };

    const handlePlaceBet = () => {
        if (disabled || isBusy) return;

        if (!inputValue || isNaN(parseFloat(inputValue))) {
            setError("Введите сумму");
            hapticSelectionChanged();
            soundEngine.playActionError();
            return;
        }

        const amount = parseTonInputToNanotons(inputValue);
        if (!amount) {
            setError("Введите корректную сумму");
            soundEngine.playActionError();
            return;
        }

        if (amount < MIN_BET_NANOTONS) {
            setError(`Мин. ${MIN_BET_TON_LABEL} TON`);
            soundEngine.playActionError();
            return;
        }

        if (amount > balanceNanotons) {
            setError("Недостаточно средств");
            soundEngine.playActionError();
            return;
        }

        hapticImpactMedium();
        soundEngine.playActionConfirm();
        onPlaceBet(amount);
        setInputValue("");
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-50 pointer-events-none px-3 pb-[max(env(safe-area-inset-bottom),0.65rem)]">
            <div className="pointer-events-auto relative overflow-hidden rounded-[1.35rem] border border-cyan-300/15 bg-[radial-gradient(130%_120%_at_8%_-20%,rgba(34,211,238,0.2),transparent_46%),radial-gradient(120%_120%_at_92%_130%,rgba(236,72,153,0.2),transparent_55%),rgba(2,6,23,0.78)] backdrop-blur-2xl focus-blur-keep shadow-[0_12px_34px_rgba(2,6,23,0.45)] p-2.5">
                <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-cyan-100/40 to-transparent" />

                {/* Controls Row */}
                <div className="flex gap-2.5 h-14">
                    {/* Input Area */}
                    <div className="flex-1 relative group">
                        <div className="absolute inset-0 rounded-2xl border border-white/12 bg-slate-950/55 transition-all duration-200 group-focus-within:border-cyan-300/55 group-focus-within:bg-slate-900/75" />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 z-20 text-[10px] font-black tracking-[0.18em] text-cyan-100/45">
                            TON
                        </span>

                        <input
                            type="number"
                            inputMode="decimal"
                            placeholder="0.0"
                            min={MIN_BET_TON_LABEL}
                            step="0.0001"
                            value={inputValue}
                            onChange={(e) => {
                                setInputValue(e.target.value);
                                setError(null);
                            }}
                            disabled={disabled || isBusy}
                            className="betting-number-input relative z-10 w-full h-full bg-transparent pl-12 pr-[9rem] text-[1.4rem] font-black font-mono text-white placeholder:text-white/15 outline-none"
                        />

                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1.5 z-20 items-center">
                            {inputValue && (
                                <button
                                    onClick={handleClear}
                                    disabled={disabled || isBusy}
                                    className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors mr-0.5"
                                >
                                    <Trash2 size={16} strokeWidth={2.5} />
                                </button>
                            )}

                            {PRESETS.map(amount => (
                                <button
                                    key={amount}
                                    onClick={() => handlePreset(amount)}
                                    disabled={disabled || isBusy}
                                    className={cn(
                                        "min-w-[36px] h-8 px-2 rounded-lg text-[0.95rem] leading-none font-black transition-all duration-200",
                                        disabled || isBusy
                                            ? "bg-white/10 text-white/25 cursor-not-allowed"
                                            : "bg-white/12 text-cyan-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-cyan-300/25 hover:text-white active:scale-95"
                                    )}
                                >
                                    +{amount}
                                </button>
                            ))}

                            <button
                                onClick={handleMax}
                                disabled={disabled || isBusy}
                                className={cn(
                                    "px-2 h-8 rounded-lg text-[0.75rem] font-black uppercase tracking-wider transition-all duration-200 flex items-center",
                                    disabled || isBusy
                                        ? "bg-white/10 text-white/25 cursor-not-allowed"
                                        : "bg-white/12 text-cyan-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-cyan-300/25 hover:text-white active:scale-95"
                                )}
                            >
                                Max
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={handlePlaceBet}
                        disabled={disabled || isBusy}
                        className={cn(
                            "relative w-[90px] rounded-2xl font-black uppercase tracking-wider text-white text-sm overflow-hidden flex items-center justify-center transition-all duration-300",
                            disabled || isBusy
                                ? "bg-slate-800/90 text-white/30 cursor-not-allowed"
                                : "bg-[linear-gradient(135deg,#ec4899_0%,#f43f5e_55%,#fb7185_100%)] shadow-[0_12px_28px_rgba(244,63,94,0.45)] hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                        )}
                    >
                        {!disabled && !isBusy && (
                            <>
                                <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/45 to-transparent" />
                                <div className="absolute inset-0 bg-[radial-gradient(80%_75%_at_50%_0%,rgba(255,255,255,0.22),transparent_70%)]" />
                            </>
                        )}
                        {isSubmitting ? (
                            <Loader2 className="w-6 h-6 animate-spin" />
                        ) : (
                            <span className="relative drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">СТАВКА</span>
                        )}
                    </button>
                </div>

                {canCancelBet && (
                    <button
                        onClick={() => {
                            if (disabled || isBusy || !onCancelBet) return;
                            hapticImpactMedium();
                            soundEngine.playUiClick();
                            onCancelBet();
                        }}
                        disabled={disabled || isBusy}
                        className={cn(
                            "mt-2.5 w-full h-10 rounded-xl font-black uppercase tracking-wide text-sm transition-all duration-200",
                            disabled || isBusy
                                ? "bg-white/10 text-white/30 cursor-not-allowed"
                                : "bg-white/8 border border-white/15 text-cyan-100 hover:bg-cyan-300/20 hover:border-cyan-200/30 active:scale-[0.99]"
                        )}
                    >
                        {isCancelling ? (
                            <span className="inline-flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Отмена...
                            </span>
                        ) : (
                            "Убрать мою ставку"
                        )}
                    </button>
                )}

                {/* Error Message */}
                <AnimatePresence>
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: 0.28, ease: "easeOut" }}
                            className="mt-2 text-center"
                        >
                            <span className="inline-block px-3 py-1 rounded-full bg-rose-500/90 text-white text-xs font-bold shadow-lg">
                                {error}
                            </span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
