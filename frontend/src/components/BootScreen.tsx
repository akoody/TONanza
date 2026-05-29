import { motion } from "framer-motion";
import { useCallback, useEffect, useRef } from "react";

interface BootScreenProps {
    onComplete: () => void;
}

const BRAND_DRAW_DELAY_SECONDS = 0.03;
const BRAND_DRAW_DURATION_SECONDS = 2.25;
const BOOT_FALLBACK_COMPLETE_MS =
    Math.round((BRAND_DRAW_DELAY_SECONDS + BRAND_DRAW_DURATION_SECONDS) * 1000) +
    10;

export function BootScreen({ onComplete }: BootScreenProps) {
    const completedRef = useRef(false);

    const completeBoot = useCallback(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        onComplete();
    }, [onComplete]);

    useEffect(() => {
        const staticSplash = document.getElementById("static-splash");
        if (!staticSplash) return;

        // Remove static splash on the next frame when React BootScreen is already mounted.
        const rafId = requestAnimationFrame(() => staticSplash.remove());
        return () => cancelAnimationFrame(rafId);
    }, []);

    useEffect(() => {
        const timeoutId = window.setTimeout(completeBoot, BOOT_FALLBACK_COMPLETE_MS);
        return () => window.clearTimeout(timeoutId);
    }, [completeBoot]);

    // Using clip-path to simulate a smooth, continuous handwriting stroke
    // from left to right. This perfectly mimics the Apple "hello" effect.
    const drawReveal = {
        hidden: { clipPath: "polygon(0 0, 0 0, 0 100%, 0% 100%)", opacity: 0 },
        visible: {
            clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)",
            opacity: 1,
            transition: {
                duration: BRAND_DRAW_DURATION_SECONDS,
                delay: BRAND_DRAW_DELAY_SECONDS,
                ease: [0.3, 0.8, 0.4, 1]
            }
        },
        exit: {
            opacity: 0,
            filter: "blur(10px)",
            scale: 1.05,
            transition: { duration: 0.05, ease: [0.45, 0, 0.55, 0.8] }
        }
    };

    return (
        <motion.div
            key="bootscreen-container"
            className="fixed inset-y-0 inset-x-0 mx-auto w-full max-w-md z-[200] flex items-center justify-center bg-gradient-to-b from-teal-950 via-cyan-900 to-teal-950 text-white overflow-hidden"
            style={{ position: 'fixed', inset: 0, margin: '0 auto', width: '100%', maxWidth: '28rem', zIndex: 9999, backgroundColor: '#042f2e' }}
        >
            <div className="pointer-events-none absolute inset-0 bg-neon-grid bg-[length:30px_30px] opacity-20" />
            <div className="absolute inset-0 z-10 drop-shadow-[0_0_20px_rgba(34,211,238,0.4)]">
                <motion.div
                    key="brand"
                    variants={drawReveal}
                    initial="hidden"
                    animate="visible"
                    onAnimationComplete={completeBoot}
                    className="absolute inset-0 flex flex-col items-center justify-center p-4"
                >
                    <div className="font-caveat font-bold text-7xl md:text-[6.5rem] tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-amber-200 pr-2">
                        TONanza
                    </div>
                </motion.div>
                </div>
        </motion.div>
    );
}
