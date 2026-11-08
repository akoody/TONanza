import { Menu } from "lucide-react";
import { soundEngine } from "../lib/audio";
import { formatNanotonsBalance } from "../lib/format";
import { WalletMenu } from "./WalletMenu";

const MOBILE_HEADER_TOP_GAP_PX = 52;
const HEADER_PADDING_TOP = `calc(env(safe-area-inset-top, 0px) + ${MOBILE_HEADER_TOP_GAP_PX}px)`;

interface AppHeaderProps {
  isDesktop: boolean;
  balanceNanotons: bigint;
  onlineUsers: number;
  onSelectionHaptic: () => void;
  onSuccessHaptic: () => void;
  onOpenPayment: (mode: "deposit" | "withdraw") => void;
  onOpenMenu: () => void;
}

export function AppHeader({
  isDesktop,
  balanceNanotons,
  onlineUsers,
  onSelectionHaptic,
  onSuccessHaptic,
  onOpenPayment,
  onOpenMenu
}: AppHeaderProps) {
  return (
    <div
          className={`fixed top-0 left-0 right-0 max-w-md mx-auto z-50 bg-teal-950/80 backdrop-blur-md border-b border-cyan-400/10 flex items-center justify-between px-4 ${isDesktop ? "py-3" : "pb-3"}`}
          style={isDesktop ? undefined : { paddingTop: HEADER_PADDING_TOP }}
        >
        {/* Left: Balance with Wallet Controls */}
        <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
          <div className="flex flex-col leading-none">
            <span className="text-[9px] text-white/40 uppercase font-bold">Баланс</span>
            <span className="text-sm font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 drop-shadow-[0_0_10px_rgba(251,191,36,0.4)]">
              {formatNanotonsBalance(balanceNanotons).replace(" TON", "")}
            </span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => {
                onSelectionHaptic();
                soundEngine.playUiClick();
                onOpenPayment("deposit");
              }}
              className="w-6 h-6 rounded bg-gradient-to-br from-emerald-500 to-teal-600 hover:brightness-110 active:scale-95 transition-all duration-200 ease-out flex items-center justify-center text-white font-bold text-xs"
              title="Депозит"
            >
              +
            </button>
            <button
              onClick={() => {
                onSelectionHaptic();
                soundEngine.playUiClick();
                onOpenPayment("withdraw");
              }}
              className="w-6 h-6 rounded bg-gradient-to-br from-rose-500 to-orange-600 hover:brightness-110 active:scale-95 transition-all duration-200 ease-out flex items-center justify-center text-white font-bold text-xs"
              title="Вывод"
            >
              −
            </button>
          </div>
        </div>

        {/* Center: Wallet Connect */}
        <div className="scale-75 origin-center">
          <WalletMenu onSelectionHaptic={onSelectionHaptic} onSuccessHaptic={onSuccessHaptic} />
        </div>

        {/* Right: Online Badge + Menu */}
        <div className="flex items-center gap-3">
          {/* Online Badge */}
          <div className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-full border border-white/5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse" />
            <span className="text-xs font-mono font-bold text-white/80">
              {onlineUsers}
            </span>
          </div>

          {/* Menu Button */}
          <button
            onClick={() => {
              onSelectionHaptic();
              soundEngine.playUiClick();
              onOpenMenu();
            }}
            className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 active:scale-95 transition-all duration-200 ease-out"
            aria-label="Открыть меню"
          >
            <Menu size={18} />
          </button>
        </div>
        </div>
  );
}
