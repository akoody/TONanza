import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { hapticImpactLight, hapticNotificationSuccess } from "../lib/telegram";
import { CircleHelp, ChevronRight, ShieldCheck } from "lucide-react";

interface WelcomeScreenProps {
    onComplete: () => void;
}

const MAIN_MENU_HEADER_TOP_GAP_PX = 52;
const MAIN_MENU_HEADER_PADDING_TOP = `calc(env(safe-area-inset-top, 0px) + ${MAIN_MENU_HEADER_TOP_GAP_PX}px)`;
const WELCOME_TOP_PADDING = "max(env(safe-area-inset-top),0.85rem)";
const INTRO_BADGE_TOP_OFFSET = `calc(${MAIN_MENU_HEADER_PADDING_TOP} - ${WELCOME_TOP_PADDING})`;

type WelcomeSlide = {
    id: string;
    icon?: ReactNode;
    title: string;
    description?: string;
    content?: ReactNode;
    actionText: string;
};

export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
    const [step, setStep] = useState(0);

    const nextStep = () => {
        hapticImpactLight();
        if (step < 2) {
            setStep(step + 1);
        } else {
            hapticNotificationSuccess();
            onComplete();
        }
    };

    const slides: WelcomeSlide[] = [
        {
            id: "intro",
            title: "TONanza",
            description: "Добро пожаловать в честную PvP-рулетку на TON. Делай ставку, следи за шансами и забирай джекпот.",
            content: (
                <div className="mx-auto w-full max-w-[22rem]">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="h-full rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-2 py-2 text-center">
                            <div className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-cyan-100/60">Честно</div>
                            <div className="mt-0.5 text-[0.72rem] font-semibold text-cyan-50">Provably Fair</div>
                        </div>
                        <div className="h-full rounded-xl border border-emerald-200/20 bg-emerald-300/10 px-2 py-2 text-center">
                            <div className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-emerald-100/60">Вывод</div>
                            <div className="mt-0.5 text-[0.72rem] font-semibold text-emerald-50">Мгновенно</div>
                        </div>
                        <div className="h-full rounded-xl border border-amber-200/20 bg-amber-300/10 px-2 py-2 text-center">
                            <div className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-amber-100/65">TON</div>
                            <div className="mt-0.5 text-[0.72rem] font-semibold text-amber-50">On-chain игра</div>
                        </div>
                        <div className="h-full rounded-xl border border-rose-200/20 bg-rose-300/10 px-2 py-2 text-center">
                            <div className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-rose-100/65">Общение</div>
                            <div className="mt-0.5 text-[0.72rem] font-semibold text-rose-50">Игровой чат</div>
                        </div>
                    </div>
                </div>
            ),
            actionText: "Начать",
        },
        {
            id: "rules",
            icon: (
                <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10">
                    <div className="absolute inset-0 rounded-2xl bg-cyan-300/15 blur-md" />
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-cyan-100/30 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.28),rgba(34,211,238,0.28)_45%,rgba(15,23,42,0.75)_100%)] shadow-[0_0_18px_rgba(34,211,238,0.35)]">
                        <CircleHelp className="h-5 w-5 text-cyan-100 drop-shadow-[0_0_8px_rgba(103,232,249,0.55)]" />
                    </div>
                </div>
            ),
            title: "Как это работает?",
            content: (
                <div className="w-full space-y-2.5">
                    <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-3.5">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-300/20 text-sm font-black text-emerald-100">1</div>
                            <div className="min-w-0 text-left">
                                <span className="block text-sm font-bold text-emerald-50">Сделай ставку</span>
                                <span className="block text-xs leading-snug text-emerald-100/75 break-words">Используй TON для входа в раунд</span>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3.5">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-300/20 text-sm font-black text-cyan-100">2</div>
                            <div className="min-w-0 text-left">
                                <span className="block text-sm font-bold text-cyan-50">Испытай удачу</span>
                                <span className="block text-xs leading-snug text-cyan-100/75 break-words">Чем выше ставка, тем выше шанс на победу</span>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-300/10 p-3.5">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-300/20 text-sm font-black text-rose-100">3</div>
                            <div className="min-w-0 text-left">
                                <span className="block text-sm font-bold text-rose-50">Забери выигрыш</span>
                                <span className="block text-xs leading-snug text-rose-100/75 break-words">Победитель автоматически получает весь банк</span>
                            </div>
                        </div>
                    </div>
                </div>
            ),
            actionText: "Понятно",
        },
        {
            id: "connect",
            icon: (
                <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10">
                    <div className="absolute inset-0 rounded-2xl bg-emerald-300/15 blur-md" />
                    <ShieldCheck className="relative h-10 w-10 text-emerald-300 drop-shadow-[0_0_16px_rgba(52,211,153,0.6)]" />
                </div>
            ),
            title: "Подключи кошелек",
            description: "Подключи TON-кошелек, чтобы делать ставки, получать выплаты и управлять балансом прямо в приложении.",
            content: (
                <div className="rounded-2xl border border-cyan-200/15 bg-slate-900/45 px-4 py-3">
                    <div className="flex items-center justify-center gap-2 text-cyan-100/85">
                        <span className="text-sm font-semibold">Поддерживаются Tonkeeper, MyTonWallet и другие</span>
                    </div>
                </div>
            ),
            actionText: "Готово",
        },
    ];

    const currentSlide = slides[step];

    return (
        <div className="fixed inset-y-0 inset-x-0 mx-auto w-full max-w-md z-[100] overflow-hidden bg-gradient-to-b from-teal-950 via-cyan-950 to-teal-950 text-white">
            <div className="pointer-events-none absolute inset-0 bg-neon-grid bg-[length:30px_30px] opacity-15" />
            <div className="pointer-events-none absolute -top-28 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 right-[-15%] h-72 w-72 rounded-full bg-rose-500/20 blur-3xl" />

            <div className="relative z-10 mx-auto flex h-full w-full max-w-md flex-col px-4 pb-[max(env(safe-area-inset-bottom),0.85rem)] pt-[max(env(safe-area-inset-top),0.85rem)]">
                <div
                    className="mb-3 flex items-center justify-between px-1"
                    style={{ marginTop: INTRO_BADGE_TOP_OFFSET }}
                >
                    <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.18em] text-white/65">
                        {step + 1}/{slides.length}
                    </span>
                </div>

                <div className="min-h-0 flex-1 flex items-center">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={step}
                            initial={{ opacity: 0, y: 18, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -14, scale: 0.98 }}
                            transition={{ duration: 0.26, ease: "easeOut" }}
                            className="w-full max-h-full overflow-y-auto no-scrollbar rounded-[1.75rem] border border-cyan-200/20 bg-[radial-gradient(145%_120%_at_10%_-10%,rgba(34,211,238,0.2),transparent_45%),radial-gradient(110%_120%_at_95%_120%,rgba(244,63,94,0.16),transparent_55%),rgba(2,6,23,0.72)] p-5 text-center shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur-2xl sm:p-6"
                        >
                            {currentSlide.icon && (
                                <div className="mb-5 mt-1">
                                    {currentSlide.icon}
                                </div>
                            )}

                            <h1 className="mb-3 text-[clamp(1.75rem,8vw,2.35rem)] font-black italic leading-tight tracking-tight text-transparent bg-gradient-to-r from-white via-cyan-100 to-amber-200 bg-clip-text drop-shadow-[0_0_22px_rgba(125,211,252,0.25)]">
                                {currentSlide.title}
                            </h1>

                            {currentSlide.description && (
                                <p className="mx-auto mb-5 max-w-[22rem] break-words text-[clamp(0.95rem,3.7vw,1.06rem)] font-medium leading-relaxed text-white/78">
                                    {currentSlide.description}
                                </p>
                            )}

                            {currentSlide.content && (
                                <div className="mb-2 w-full">
                                    {currentSlide.content}
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>

                <div className="mt-4 flex w-full flex-col items-center gap-3.5">
                    <div className="flex gap-1.5">
                        {slides.map((_, i) => (
                            <div
                                key={i}
                                className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-8 bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.75)]" : "w-2 bg-white/20"
                                    }`}
                            />
                        ))}
                    </div>

                    <button
                        onClick={nextStep}
                        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#ec4899_0%,#f43f5e_55%,#fb7185_100%)] text-lg font-black text-white shadow-[0_14px_30px_rgba(244,63,94,0.45)] transition-all duration-200 hover:brightness-110 active:scale-[0.985]"
                    >
                        <span>{currentSlide.actionText}</span>
                        <ChevronRight size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}
