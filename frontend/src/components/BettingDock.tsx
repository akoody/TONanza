import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils";
import { hapticImpactMedium, hapticSelectionChanged } from "../lib/telegram";

interface BettingDockProps {
    balanceNanotons: bigint;
    currentPotNanotons: bigint;
    isSubmitting: boolean;
    disabled?: boolean;
    onPlaceBet: (amount: bigint) => void;
}

const PRESETS = [1, 5, 10, 50];

export function BettingDock({
    balanceNanotons,
    currentPotNanotons,
    isSubmitting,
    disabled,
    onPlaceBet
}: BettingDockProps) {
    const [inputValue, setInputValue] = useState("");
    const [error, setError] = useState<string | null>(null);

    const betAmount = BigInt(Math.floor(parseFloat(inputValue || "0") * 1e9));
    const newPot = currentPotNanotons + betAmount;
    const winChance = newPot > 0n ? Number((betAmount * 10000n) / newPot) / 100 : 0;

    const handlePreset = (amountTon: number) => {
        hapticSelectionChanged();
        setInputValue(amountTon.toString());
        setError(null);
    };

    const handlePlaceBet = () => {
        if (disabled || isSubmitting) return;

        if (!inputValue || isNaN(parseFloat(inputValue))) {
            setError("Введите сумму");
            hapticSelectionChanged();
            return;
        }

        const amount = BigInt(Math.floor(parseFloat(inputValue) * 1e9));

        if (amount <= 0n) {
            setError("Мин. 0.1 TON");
            return;
        }

        if (amount > balanceNanotons) {
            setError("Недостаточно средств");
            return;
        }

        hapticImpactMedium();
        onPlaceBet(amount);
        setInputValue("");
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col pointer-events-none">
            {/* Gradient Fade from Content to Dock */}
            <div className="h-12 w-full bg-gradient-to-b from-transparent to-black pointer-events-none" />

            <div className="bg-black/95 backdrop-blur-xl border-t border-white/10 px-4 pb-8 pt-2 pointer-events-auto">
                {/* Balance Display (NEW) */}
                <div className="flex justify-between items-center mb-2 px-1">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Ваш счет</span>
                    </div>
                    <div className="font-mono font-black text-sm text-brand-gold drop-shadow-[0_0_10px_rgba(255,215,0,0.5)]">
                        {balanceNanotons > 0n ? (Number(balanceNanotons) / 1e9).toFixed(2) : "0.00"} TON
                    </div>
                </div>

                {/* Win Chance Bar — THICKER + BRIGHTER */}
                <div className="mb-3">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-wider mb-1.5">
                        <span className="text-white/60">Шанс на победу</span>
                        <span className={cn(
                            "font-mono tabular-nums",
                            winChance > 50 ? "text-emerald-400" : winChance > 20 ? "text-amber-400" : "text-white/60"
                        )}>
                            {winChance.toFixed(1)}%
                        </span>
                    </div>
                    <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                        <motion.div
                            className={cn(
                                "h-full rounded-full",
                                winChance > 50
                                    ? "bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.5)]"
                                    : winChance > 20
                                        ? "bg-gradient-to-r from-amber-500 to-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.4)]"
                                        : "bg-gradient-to-r from-brand-purple to-brand-pink shadow-[0_0_12px_rgba(236,72,153,0.4)]"
                            )}
                            animate={{ width: `${Math.min(100, winChance)}%` }}
                            transition={{ duration: 0.3 }}
                        />
                    </div>
                </div>

                {/* Controls Row */}
                <div className="flex gap-3 h-14">
                    {/* Input Area */}
                    <div className="flex-1 relative group">
                        <div className="absolute inset-0 bg-white/5 rounded-xl border border-white/10 group-focus-within:border-cyan-500/50 transition-colors" />
                        <input
                            type="number"
                            inputMode="decimal"
                            placeholder="0.0"
                            value={inputValue}
                            onChange={(e) => {
                                setInputValue(e.target.value);
                                setError(null);
                            }}
                            disabled={disabled || isSubmitting}
                            className="relative w-full h-full bg-transparent px-4 py-2 text-xl font-black font-mono text-white placeholder:text-white/10 outline-none z-10"
                        />

                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 z-20">
                            {PRESETS.slice(0, 2).map(amount => (
                                <button
                                    key={amount}
                                    onClick={() => handlePreset(amount)}
                                    disabled={disabled}
                                    className="px-2 py-1 text-xs font-bold bg-white/10 hover:bg-white/20 rounded text-white/70 transition-colors"
                                >
                                    +{amount}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Main Button — volumetric 3D look */}
                    <button
                        onClick={handlePlaceBet}
                        disabled={disabled || isSubmitting}
                        className={cn(
                            "relative w-[120px] rounded-xl font-black uppercase tracking-wider text-white overflow-hidden flex items-center justify-center transition-all",
                            disabled
                                ? "bg-slate-800 text-white/20 cursor-not-allowed"
                                : "bg-gradient-to-r from-pink-500 to-rose-600 shadow-lg shadow-pink-500/40 hover:shadow-pink-500/60 hover:scale-105 active:scale-95 transition-all duration-300"
                        )}
                    >
                        {/* Top highlight for 3D effect */}
                        {!disabled && (
                            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                        )}
                        {isSubmitting ? (
                            <Loader2 className="w-6 h-6 animate-spin" />
                        ) : (
                            <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">СТАВКА</span>
                        )}
                    </button>
                </div>

                {/* Error Message */}
                <AnimatePresence>
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="absolute -top-8 left-0 right-0 text-center"
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
