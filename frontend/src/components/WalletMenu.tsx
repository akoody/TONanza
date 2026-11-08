import { TonConnectButton, useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Copy, LogOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { soundEngine } from "../lib/audio";
import { useToast } from "./ui/Toast";

const formatWalletAddressShort = (address: string) => {
  if (!address) return "";
  if (address.length <= 7) return address;
  return `${address.slice(0, 3)}...${address.slice(-4)}`;
};

interface WalletMenuProps {
  onSelectionHaptic: () => void;
  onSuccessHaptic: () => void;
}

/** Кнопка подключения TON-кошелька и меню подключённого адреса. */
export function WalletMenu({ onSelectionHaptic: triggerSelectionHaptic, onSuccessHaptic: triggerSuccessHaptic }: WalletMenuProps) {
  const { toast } = useToast();
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const tonAddress = useTonAddress();
  const compactTonAddress = useMemo(() => formatWalletAddressShort(tonAddress), [tonAddress]);
  const [isWalletDropdownOpen, setIsWalletDropdownOpen] = useState(false);
  const walletDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tonWallet) {
      setIsWalletDropdownOpen(false);
    }
  }, [tonWallet]);

  useEffect(() => {
    if (!isWalletDropdownOpen) return;

    const onPointerDownOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || walletDropdownRef.current?.contains(target)) return;
      setIsWalletDropdownOpen(false);
    };

    document.addEventListener("mousedown", onPointerDownOutside);
    document.addEventListener("touchstart", onPointerDownOutside);
    return () => {
      document.removeEventListener("mousedown", onPointerDownOutside);
      document.removeEventListener("touchstart", onPointerDownOutside);
    };
  }, [isWalletDropdownOpen]);

  const handleCopyWalletAddress = useCallback(async () => {
    if (!tonAddress) return;
    try {
      await navigator.clipboard.writeText(tonAddress);
      triggerSuccessHaptic();
      toast("Адрес кошелька скопирован", "success", 2200);
    } catch (e) {
      console.error("[wallet] failed to copy address", e);
      toast("Не удалось скопировать адрес", "error");
    } finally {
      setIsWalletDropdownOpen(false);
    }
  }, [tonAddress, toast, triggerSuccessHaptic]);

  const handleDisconnectWallet = useCallback(async () => {
    try {
      await tonConnectUI?.disconnect();
      toast("Кошелек отключен", "info", 2200);
    } catch (e) {
      console.error("[wallet] failed to disconnect", e);
      toast("Не удалось отключить кошелек", "error");
    } finally {
      setIsWalletDropdownOpen(false);
    }
  }, [tonConnectUI, toast]);

  if (!tonWallet) {
    return <TonConnectButton className="wallet-connect-compact" />;
  }

  return (
            <div ref={walletDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  triggerSelectionHaptic();
                  soundEngine.playUiClick();
                  setIsWalletDropdownOpen((prev) => !prev);
                }}
                className="h-10 w-[142px] rounded-xl border border-white/10 bg-white/5 px-3 text-white shadow-[0_4px_16px_rgba(2,6,23,0.5)] transition-all hover:bg-white/10 active:scale-95 flex items-center justify-between gap-1.5"
                aria-label="Меню кошелька"
                aria-expanded={isWalletDropdownOpen}
              >
                <span className="font-mono text-[14px] font-semibold leading-none">
                  {compactTonAddress}
                </span>
                <ChevronDown
                  size={14}
                  className={`text-white/70 transition-transform ${isWalletDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence mode="wait" initial={false}>
                {isWalletDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute right-0 top-full mt-2 w-40 overflow-hidden rounded-xl border border-white/10 bg-slate-950/95 backdrop-blur-xl shadow-[0_14px_30px_rgba(2,6,23,0.65)]"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        triggerSelectionHaptic();
                        soundEngine.playUiClick();
                        void handleCopyWalletAddress();
                      }}
                      className="w-full px-3 py-2.5 text-left text-sm text-white/85 hover:bg-white/10 transition-all duration-200 ease-out active:scale-[0.99] flex items-center gap-2"
                    >
                      <Copy size={14} />
                      Копировать
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerSelectionHaptic();
                        soundEngine.playUiClick();
                        void handleDisconnectWallet();
                      }}
                      className="w-full px-3 py-2.5 text-left text-sm text-rose-300 hover:bg-rose-500/10 transition-all duration-200 ease-out active:scale-[0.99] flex items-center gap-2"
                    >
                      <LogOut size={14} />
                      Отключить
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
  );
}
