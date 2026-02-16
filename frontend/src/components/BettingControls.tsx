import { motion } from "framer-motion";
import { Coins, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { formatNanotonsToTon, parseTonInputToNanotons } from "../lib/format";
import { hapticImpactLight } from "../lib/telegram";

type BettingControlsProps = {
  balanceNanotons: bigint;
  disabled?: boolean;
  isSubmitting?: boolean;
  onPlaceBet: (amountNanotons: bigint) => Promise<void>;
};

const NANOTONS_PER_TON = 1_000_000_000n;

const nanotonsToInput = (value: bigint): string => {
  const whole = value / NANOTONS_PER_TON;
  const fraction = value % NANOTONS_PER_TON;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionText = fraction.toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText}`;
};

export const BettingControls = ({
  balanceNanotons,
  disabled = false,
  isSubmitting = false,
  onPlaceBet
}: BettingControlsProps) => {
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parsedInput = useMemo(() => parseTonInputToNanotons(inputValue), [inputValue]);

  const applyQuickBet = (extraTon: bigint) => {
    hapticImpactLight();
    const base = parsedInput ?? 0n;
    const next = base + extraTon * NANOTONS_PER_TON;
    setInputValue(nanotonsToInput(next));
    setError(null);
  };

  const applyAllIn = () => {
    hapticImpactLight();
    setInputValue(nanotonsToInput(balanceNanotons));
    setError(null);
  };

  const submit = async () => {
    hapticImpactLight();

    if (!parsedInput || parsedInput <= 0n) {
      setError("Enter a valid amount");
      return;
    }

    if (parsedInput > balanceNanotons) {
      setError("Bet is larger than your local balance");
      return;
    }

    setError(null);
    await onPlaceBet(parsedInput);
    setInputValue("");
  };

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-50 border-t border-teal-500/15 bg-slate-950/80 px-4 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] pt-3 backdrop-blur-xl"
      style={{ WebkitBackdropFilter: "blur(16px)" }}
    >
      <div className="mx-auto flex w-full max-w-[620px] flex-col gap-3">
        <div className="flex items-center justify-between rounded-2xl border border-teal-500/10 bg-teal-900/20 px-4 py-3">
          <span className="text-xs uppercase tracking-[0.16em] text-teal-200/70">Local balance</span>
          <span className="font-mono text-sm text-slate-100">{formatNanotonsToTon(balanceNanotons)}</span>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-teal-500/15 bg-slate-900/75 px-4">
            <Coins className="h-4 w-4 text-teal-300" />
            <input
              value={inputValue}
              onChange={(event) => {
                setInputValue(event.target.value.replace(/[^0-9.,]/g, ""));
                setError(null);
              }}
              placeholder="Bet amount in TON"
              className="h-full w-full bg-transparent font-mono text-lg text-slate-100 outline-none placeholder:text-teal-200/40"
              inputMode="decimal"
              disabled={disabled || isSubmitting}
            />
          </label>

          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={submit}
            disabled={disabled || isSubmitting}
            className="min-h-14 rounded-2xl bg-gradient-to-r from-pink-500 to-fuchsia-500 px-5 font-semibold uppercase tracking-[0.08em] text-white shadow-action transition hover:from-pink-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {isSubmitting ? "Sending" : "Place Bet"}
            </span>
          </motion.button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => applyQuickBet(1n)}
            className="min-h-14 rounded-xl border border-teal-500/15 bg-teal-900/25 text-sm font-medium text-teal-100 transition hover:bg-teal-900/40"
            disabled={disabled || isSubmitting}
          >
            +1 TON
          </button>
          <button
            type="button"
            onClick={() => applyQuickBet(5n)}
            className="min-h-14 rounded-xl border border-teal-500/15 bg-teal-900/25 text-sm font-medium text-teal-100 transition hover:bg-teal-900/40"
            disabled={disabled || isSubmitting}
          >
            +5 TON
          </button>
          <button
            type="button"
            onClick={applyAllIn}
            className="min-h-14 rounded-xl border border-pink-500/35 bg-pink-500/15 text-sm font-semibold uppercase tracking-[0.08em] text-pink-200 transition hover:bg-pink-500/25"
            disabled={disabled || isSubmitting || balanceNanotons <= 0n}
          >
            All In
          </button>
        </div>

        {error && <p className="text-sm text-rose-300">{error}</p>}
      </div>
    </aside>
  );
};
