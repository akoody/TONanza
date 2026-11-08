import { AnimatePresence, motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";

interface FairnessModalProps {
  isOpen: boolean;
  serverSeedHash: string;
  onClose: () => void;
}

export function FairnessModal({ isOpen, serverSeedHash, onClose }: FairnessModalProps) {
  return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.975, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.985, y: 10 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="bg-slate-900 border border-white/10 p-6 rounded-2xl max-w-sm w-full"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <ShieldCheck className="text-cyan-400" /> Честная игра
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-white/50 uppercase block mb-1">Хэш серверного сида</label>
                  <div className="bg-black/50 p-2 rounded text-xs font-mono break-all text-white/80 border border-white/5">
                    {serverSeedHash}
                  </div>
                </div>
                <p className="text-xs text-white/40 leading-relaxed">
                  Эта игра использует доказуемо честную систему. Серверный сид генерируется перед началом раунда и хэшируется. Вы можете проверить результат после окончания раунда.
                </p>
                <button
                  onClick={onClose}
                  className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-sm transition-all duration-200 ease-out active:scale-[0.99]"
                >
                  Закрыть
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
  );
}
