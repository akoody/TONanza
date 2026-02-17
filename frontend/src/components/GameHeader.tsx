import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { formatNanotonsCompact } from "../lib/format";

interface GameHeaderProps {
  totalPotNanotons: bigint;
  remainingSeconds: number;
  countdownStarted: boolean;
  roundDuration: number;
}

export function GameHeader({
  totalPotNanotons,
  remainingSeconds,
  countdownStarted,
  roundDuration,
}: GameHeaderProps) {
  const [prevPot, setPrevPot] = useState(totalPotNanotons);
  const [isPotJumping, setIsPotJumping] = useState(false);

  useEffect(() => {
    if (totalPotNanotons !== prevPot) {
      setIsPotJumping(true);
      const timer = setTimeout(() => setIsPotJumping(false), 400);
      setPrevPot(totalPotNanotons);
      return () => clearTimeout(timer);
    }
  }, [totalPotNanotons, prevPot]);

  const progressPercentage = countdownStarted
    ? (remainingSeconds / roundDuration) * 100
    : 100;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timerText = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  const isPanic = countdownStarted && remainingSeconds <= 5;

  const getTimerTextColor = () => {
    if (!countdownStarted || remainingSeconds > 10) return "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]";
    if (remainingSeconds > 5) return "text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]";
    return "text-rose-400 drop-shadow-[0_0_12px_rgba(244,63,94,0.7)]";
  };

  return (
    <div className="flex flex-col items-center justify-center w-full py-4 space-y-3 relative z-10">
      {/* Total Pot — with GLOW */}
      <div className="relative">
        <motion.div
          animate={isPotJumping
            ? { scale: [1, 1.15, 1.05, 1], filter: ["brightness(1)", "brightness(1.5)", "brightness(1.2)", "brightness(1)"] }
            : {}
          }
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="relative z-10 text-center"
        >
          <div className="text-[10px] font-bold tracking-widest text-cyan-400/70 uppercase mb-0.5">
            Текущий банк
          </div>
          <h1
            className="text-4xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 tabular-nums leading-none"
            style={{
              filter: "drop-shadow(0 0 15px rgba(251,191,36,0.6))",
            }}
          >
            {formatNanotonsCompact(totalPotNanotons)}
          </h1>
        </motion.div>

        {/* Strong golden glow behind pot */}
        <motion.div
          animate={isPotJumping ? { scale: [1, 1.5, 1], opacity: [0.2, 0.5, 0.2] } : { opacity: 0.2 }}
          transition={{ duration: 0.3 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-20 bg-amber-500/30 blur-[40px] rounded-full pointer-events-none"
        />
      </div>

      {/* Timer Display — with shake on panic */}
      <motion.div
        key={remainingSeconds}
        initial={{ scale: 1.1, opacity: 0.7 }}
        animate={{
          scale: 1,
          opacity: 1,
          x: isPanic ? [0, -3, 3, -2, 2, 0] : 0,
        }}
        transition={isPanic
          ? { duration: 0.4, x: { duration: 0.4, ease: "easeInOut" } }
          : { duration: 0.2 }
        }
        className={cn(
          "font-mono font-black text-2xl tracking-widest tabular-nums",
          getTimerTextColor(),
          isPanic && "animate-timer-shake"
        )}
      >
        {countdownStarted ? timerText : (
          <span className="text-base text-white/30 font-bold tracking-wider">Ожидание игроков...</span>
        )}
      </motion.div>

      {/* Visual Timer Progress Bar — NOW UNDER DIGITS */}
      <div className="w-full max-w-[120px] h-1.5 bg-white/10 rounded-full overflow-hidden relative backdrop-blur-sm mt-1">
        <motion.div
          className={cn("h-full absolute left-0 top-0 transition-colors duration-300 rounded-full",
            !countdownStarted || remainingSeconds > 20 ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" :
              remainingSeconds > 5 ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" :
                "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,1)] animate-pulse"
          )}
          initial={{ width: "100%" }}
          animate={{
            width: `${progressPercentage}%`
          }}
          transition={{ duration: 1, ease: "linear" }}
        />
      </div>
    </div>
  );
}
