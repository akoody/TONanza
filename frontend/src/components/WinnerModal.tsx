import { motion } from "framer-motion";
import { formatNanotonsCompact } from "../lib/format";
import { parseSafeBigInt } from "../lib/security";

interface WinnerModalProps {
  amountNanotons: string | null;
  isClaiming: boolean;
  isCredited: boolean;
  onClaim: () => void;
}

export function WinnerModal({ amountNanotons, isClaiming, isCredited, onClaim }: WinnerModalProps) {
  return (
    <div className="fixed inset-0 z-[220] bg-black/85 backdrop-blur-md">
          <div className="mx-auto flex h-full w-full max-w-md items-center justify-center p-4">
            <div className="relative w-full max-w-sm overflow-hidden rounded-[2rem] border border-amber-300/60 bg-slate-900 text-center text-white shadow-[0_0_50px_rgba(255,215,0,0.3)]">
              <div className="absolute inset-0 bg-gradient-brand opacity-10 pointer-events-none" />

              <div className="relative p-8">
                <motion.div
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="mb-4 text-6xl drop-shadow-[0_0_15px_rgba(255,215,0,0.8)]"
                >
                  👑
                </motion.div>

                <h2 className="mb-2 text-2xl font-black uppercase tracking-widest text-white">Джекпот!</h2>

                <div className="mb-6 text-sm font-bold uppercase tracking-wide text-white/70">
                  Победитель забирает всё
                </div>

                <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-4xl font-mono font-black text-amber-300 drop-shadow-[0_0_12px_rgba(251,191,36,0.35)]">
                    {amountNanotons ? formatNanotonsCompact(parseSafeBigInt(amountNanotons)) : "---"}
                  </div>
                </div>

                <button
                  onClick={onClaim}
                  disabled={isClaiming}
                  className="w-full rounded-xl bg-gradient-gold py-4 text-black font-black uppercase tracking-widest shadow-[0_0_20px_rgba(255,215,0,0.4)] transition-all hover:brightness-110 active:translate-y-0.5 active:scale-95"
                >
                  {isClaiming ? "Зачисляем..." : isCredited ? "Продолжить" : "Забрать выигрыш"}
                </button>
              </div>
            </div>
          </div>
        </div>
  );
}
