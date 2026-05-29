import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { X, ArrowUpCircle, ArrowDownCircle, CheckCircle2, Loader2, Wallet, AlertCircle } from "lucide-react";
import { useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";
import { formatNanotonsBalance, formatNanotonsCompact, formatNanotonsForInput, parseTonInputToNanotons } from "../lib/format";
import { getMyBalance, requestWithdrawal } from "../lib/api";
import { soundEngine } from "../lib/audio";

// The app's hot wallet address — users send TON here for deposits
const APP_WALLET_ADDRESS = "UQDEib2uJaspiC4J2cTVVw9awBEqnZSPpsh_H8CMfDxxphM-";
const MIN_AMOUNT_TON = 0.1;
const AMOUNT_INPUT_STEP_TON = 0.01;
const MIN_AMOUNT_NANOTONS = 100_000_000n;
const DEPOSIT_POLL_INTERVAL_MS = 3000;
const DEPOSIT_POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const DEPOSIT_VERIFY_TIMEOUT_MS = 45 * 1000; // 45 seconds after wallet error/cancel
const MODAL_BACKDROP_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
const MODAL_SHEET_TRANSITION = { type: "spring" as const, stiffness: 300, damping: 32, mass: 0.95 };
const SUCCESS_ICON_TRANSITION = { type: "spring" as const, stiffness: 260, damping: 22, mass: 0.9 };
const DEPOSIT_STATUS_MIN_HEIGHT = "calc(68svh - 10rem)";

const getDepositErrorMessage = (error: unknown): { message: string; isCancelled: boolean } => {
    const rawMessage =
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as { message?: unknown }).message === "string"
            ? (error as { message: string }).message
            : typeof error === "string"
                ? error
                : "";

    const normalized = rawMessage.toLowerCase();
    const isCancelled = [
        "user rejects",
        "user rejected",
        "transaction was not sent",
        "reject",
        "declined",
        "cancelled",
        "canceled"
    ].some((token) => normalized.includes(token));

    if (isCancelled) {
        return { message: "Пополнение отменено", isCancelled: true };
    }

    return { message: "Ошибка пополнения. Попробуйте ещё раз.", isCancelled: false };
};

const bringFocusedInputIntoView = (input: HTMLInputElement) => {
    window.setTimeout(() => {
        const modalCard = input.closest(".payment-modal-card");
        if (!(modalCard instanceof HTMLElement)) return;

        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const rect = input.getBoundingClientRect();
        const safeTop = 96;
        const safeBottom = viewportHeight - 16;

        if (rect.bottom > safeBottom) {
            modalCard.scrollBy({ top: rect.bottom - safeBottom + 24, behavior: "auto" });
            return;
        }

        if (rect.top < safeTop) {
            modalCard.scrollBy({ top: rect.top - safeTop - 12, behavior: "auto" });
        }
    }, 120);
};

function crc32c(bytes: Uint8Array): Uint8Array {
    const POLY = 0x82f63b78;
    let crc = 0xffffffff;

    for (let n = 0; n < bytes.length; n += 1) {
        crc ^= bytes[n];
        for (let i = 0; i < 8; i += 1) {
            crc = (crc & 1) !== 0 ? (crc >>> 1) ^ POLY : crc >>> 1;
        }
    }

    crc = (crc ^ 0xffffffff) >>> 0;
    const out = new Uint8Array(4);
    const view = new DataView(out.buffer);
    // TON BOC stores crc32c bytes in little-endian order.
    view.setUint32(0, crc, true);
    return out;
}

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function buildCommentPayload(comment: string): string {
    const commentBytes = new TextEncoder().encode(comment);

    // text_comment#00000000 + UTF-8 comment
    const payloadData = new Uint8Array(4 + commentBytes.length);
    payloadData.set(commentBytes, 4);

    // Cell descriptors: ordinary cell (0 refs), full-byte data.
    const cell = new Uint8Array(2 + payloadData.length);
    cell[0] = 0x00;
    cell[1] = payloadData.length * 2;
    cell.set(payloadData, 2);

    // Reach BOC with index + crc32c, single root cell.
    const bocWithoutCrc = new Uint8Array(12 + cell.length);
    let offset = 0;
    bocWithoutCrc[offset++] = 0xb5;
    bocWithoutCrc[offset++] = 0xee;
    bocWithoutCrc[offset++] = 0x9c;
    bocWithoutCrc[offset++] = 0x72;
    bocWithoutCrc[offset++] = 0xc1; // has_idx=1, has_crc32c=1, size_bytes=1
    bocWithoutCrc[offset++] = 0x01; // off_bytes
    bocWithoutCrc[offset++] = 0x01; // cells_num
    bocWithoutCrc[offset++] = 0x01; // roots_num
    bocWithoutCrc[offset++] = 0x00; // absent_num
    bocWithoutCrc[offset++] = cell.length; // tot_cells_size
    bocWithoutCrc[offset++] = 0x00; // root index
    bocWithoutCrc[offset++] = 0x00; // index for first cell
    bocWithoutCrc.set(cell, offset);

    const crc = crc32c(bocWithoutCrc);
    const boc = new Uint8Array(bocWithoutCrc.length + crc.length);
    boc.set(bocWithoutCrc, 0);
    boc.set(crc, bocWithoutCrc.length);

    return toBase64(boc);
}

type DepositStep = "amount" | "sending" | "waiting" | "success";
type WithdrawStep = "amount" | "confirming" | "success";

interface PaymentModalProps {
    mode: "deposit" | "withdraw";
    isOpen: boolean;
    onClose: () => void;
    serverUserId: string | null;
    balanceNanotons: bigint;
    onBalanceRefresh: () => Promise<void>;
}

type DepositPollingConfig = {
    baselineBalance: bigint;
    timeoutMs: number;
    onTimeout: () => void;
};

// ─── Deposit Flow ──────────────────────────────────────────────────────────────

function DepositFlow({
    serverUserId,
    balanceNanotons,
    onBalanceRefresh,
    onClose
}: {
    serverUserId: string | null;
    balanceNanotons: bigint;
    onBalanceRefresh: () => Promise<void>;
    onClose: () => void;
}) {
    const [tonConnectUI] = useTonConnectUI();
    const userFriendlyAddress = useTonAddress();

    const [step, setStep] = useState<DepositStep>("amount");
    const [waitingMode, setWaitingMode] = useState<"sent" | "verifying">("sent");
    const [amountTon, setAmountTon] = useState("");
    const [error, setError] = useState("");
    const [creditedAmount, setCreditedAmount] = useState<bigint>(0n);

    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const balanceBeforeRef = useRef<bigint>(balanceNanotons);

    const stopPolling = useCallback(() => {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        pollTimerRef.current = null;
        pollTimeoutRef.current = null;
    }, []);

    useEffect(() => () => stopPolling(), [stopPolling]);

    const startPolling = useCallback((config: DepositPollingConfig) => {
        stopPolling();
        balanceBeforeRef.current = config.baselineBalance;

        pollTimerRef.current = setInterval(async () => {
            try {
                const fresh = await getMyBalance();
                const newBalance = BigInt(fresh.balanceNanotons);
                if (newBalance > balanceBeforeRef.current) {
                    stopPolling();
                    setCreditedAmount(newBalance - balanceBeforeRef.current);
                    setStep("success");
                    soundEngine.playActionSuccess();
                    await onBalanceRefresh();
                }
            } catch {
                // silently retry
            }
        }, DEPOSIT_POLL_INTERVAL_MS);

        pollTimeoutRef.current = setTimeout(() => {
            stopPolling();
            config.onTimeout();
        }, config.timeoutMs);
    }, [onBalanceRefresh, stopPolling]);

    const handleSend = async () => {
        setError("");
        const nanotons = parseTonInputToNanotons(amountTon);
        if (!nanotons || nanotons < MIN_AMOUNT_NANOTONS) {
            setError(`Минимальная сумма — ${MIN_AMOUNT_TON} TON`);
            soundEngine.playActionError();
            return;
        }

        if (!serverUserId) {
            setError("Не удалось определить ваш аккаунт. Попробуйте перезайти.");
            soundEngine.playActionError();
            return;
        }

        // Comment is the idempotency key — wallet watcher uses it to credit the right user
        const comment = `uid:${serverUserId}`;
        const baselineBalance = balanceNanotons;

        setStep("sending");
        soundEngine.playActionConfirm();

        try {
            const payload = buildCommentPayload(comment);

            await tonConnectUI.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 600, // 10 min
                messages: [
                    {
                        address: APP_WALLET_ADDRESS,
                        amount: nanotons.toString(),
                        payload
                    }
                ]
            });

            // Transaction sent — now poll for balance change
            setWaitingMode("sent");
            setStep("waiting");
            startPolling({
                baselineBalance,
                timeoutMs: DEPOSIT_POLL_TIMEOUT_MS,
                onTimeout: () => {
                    setError("Время ожидания истекло. Если вы отправили TON, баланс обновится позже автоматически.");
                    soundEngine.playActionError();
                    setStep("amount");
                }
            });
        } catch (e: unknown) {
            const normalizedError = getDepositErrorMessage(e);
            if (normalizedError.isCancelled) {
                setError("");
                setWaitingMode("verifying");
                setStep("waiting");
                startPolling({
                    baselineBalance,
                    timeoutMs: DEPOSIT_VERIFY_TIMEOUT_MS,
                    onTimeout: () => {
                        setError("Пополнение не подтверждено. Если TON уже списались, зачисление выполнится автоматически после подтверждения сети.");
                        setStep("amount");
                    }
                });
                return;
            }

            setStep("amount");
            setError(normalizedError.message);
            soundEngine.playActionError();
        }
    };

    // ── Step: Amount Input ──
    if (step === "amount") {
        return (
            <div className="space-y-5">
                <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
                        <ArrowUpCircle className="text-emerald-400" size={28} />
                    </div>
                    <h2 className="text-xl font-black text-white">Пополнить баланс</h2>
                    <p className="text-sm text-white/40 mt-1">Через TON кошелёк</p>
                </div>

                <div>
                    <label className="text-xs text-white/50 uppercase font-bold block mb-2">Сумма (TON)</label>
                    <div className="relative">
                        <input
                            type="number"
                            inputMode="decimal"
                            value={amountTon}
                            onChange={e => { setAmountTon(e.target.value); setError(""); }}
                            onFocus={e => bringFocusedInputIntoView(e.currentTarget)}
                            placeholder="0.5"
                            min={MIN_AMOUNT_TON}
                            step={AMOUNT_INPUT_STEP_TON}
                            className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white font-mono text-lg placeholder:text-white/20 focus:outline-none focus:border-cyan-400/50 pr-16"
                            style={{ fontSize: 16 }}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 font-bold text-sm">TON</span>
                    </div>
                    {/* Quick amount buttons */}
                    <div className="flex gap-2 mt-2">
                        {[0.5, 1, 5, 10].map(v => (
                            <button
                                key={v}
                                onClick={() => { setAmountTon(String(v)); setError(""); }}
                                className="flex-1 py-1.5 text-xs font-bold rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition-all"
                            >
                                {v}
                            </button>
                        ))}
                    </div>
                </div>

                {!userFriendlyAddress && (
                    <div className="!mt-8 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2">
                        <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-300">
                            Кошелёк не подключён. Нажмите кнопку «Connect Wallet» в шапке, чтобы подключить Tonkeeper или другой кошелёк.
                        </p>
                    </div>
                )}

                {userFriendlyAddress && (
                    <div className="!mt-8 bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-2">
                        <Wallet size={14} className="text-cyan-400 shrink-0" />
                        <span className="text-xs text-white/60 font-mono truncate">
                            {userFriendlyAddress.slice(0, 4)}…{userFriendlyAddress.slice(-4)}
                        </span>
                        <span className="ml-auto text-[10px] text-emerald-400 font-bold uppercase">Подключён</span>
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                        <AlertCircle size={14} className="shrink-0" />
                        {error}
                    </div>
                )}

                <button
                    onClick={handleSend}
                    disabled={!userFriendlyAddress || !amountTon}
                    className="!mt-8 w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 font-black text-white text-base shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 active:scale-95 transition-all"
                >
                    {!userFriendlyAddress ? "Сначала подключите кошелёк" : "Пополнить через TON Connect"}
                </button>

                <p className="text-[10px] text-white/30 text-center leading-relaxed">
                    Откроется ваш TON кошелёк для подтверждения транзакции. Средства зачислятся автоматически.
                </p>
            </div>
        );
    }

    // ── Step: Sending (wallet modal open) ──
    if (step === "sending") {
        return (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
                <Loader2 className="text-cyan-400 animate-spin" size={48} />
                <p className="text-white font-bold text-lg">Открываем кошелёк…</p>
                <p className="text-white/40 text-sm text-center">Подтвердите транзакцию в вашем TON кошелёке</p>
            </div>
        );
    }

    // ── Step: Waiting for blockchain confirmation ──
    if (step === "waiting") {
        return (
            <div
                className="flex flex-col items-center justify-center space-y-5 py-8"
                style={{ minHeight: DEPOSIT_STATUS_MIN_HEIGHT }}
            >
                <div className="relative">
                    <div className="w-20 h-20 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl">⛓️</span>
                    </div>
                </div>
                <div className="text-center space-y-1">
                    <p className="text-white font-bold text-lg">
                        {waitingMode === "verifying" ? "Проверяем транзакцию" : "Ожидание подтверждения"}
                    </p>
                    <p className="text-white/40 text-sm">
                        {waitingMode === "verifying"
                            ? "Проверяем сеть на случай, если кошелёк уже отправил TON"
                            : "Транзакция отправлена в блокчейн"}
                    </p>
                    <p className="text-white/25 text-xs">
                        {waitingMode === "verifying" ? "Это может занять до 45 секунд" : "Обычно занимает до 15 секунд"}
                    </p>
                </div>
                <button
                    onClick={() => {
                        soundEngine.playUiClick();
                        stopPolling();
                        setStep("amount");
                    }}
                    className="text-xs text-white/30 hover:text-white/60 transition-colors underline"
                >
                    Отмена
                </button>
            </div>
        );
    }

    // ── Step: Success ──
    return (
        <div
            className="flex flex-col items-center justify-center space-y-5 py-6"
            style={{ minHeight: DEPOSIT_STATUS_MIN_HEIGHT }}
        >
            <motion.div
                initial={{ scale: 0.84, opacity: 0.3 }}
                animate={{ scale: 1 }}
                transition={SUCCESS_ICON_TRANSITION}
            >
                <CheckCircle2 className="text-emerald-400" size={64} />
            </motion.div>
            <div className="text-center space-y-2">
                <p className="text-white font-black text-2xl">Зачислено!</p>
                <div className="text-3xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
                    +{formatNanotonsCompact(creditedAmount)}
                </div>
                <p className="text-white/40 text-sm">Баланс обновлён</p>
            </div>
            <button
                onClick={() => {
                    soundEngine.playUiClick();
                    onClose();
                }}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 font-black text-white shadow-lg shadow-emerald-500/20 hover:brightness-110 active:scale-95 transition-all"
            >
                Отлично!
            </button>
        </div>
    );
}

// ─── Withdrawal Flow ───────────────────────────────────────────────────────────

function WithdrawFlow({
    balanceNanotons,
    onBalanceRefresh
}: {
    balanceNanotons: bigint;
    onBalanceRefresh: () => Promise<void>;
}) {
    const userFriendlyAddress = useTonAddress();

    const [step, setStep] = useState<WithdrawStep>("amount");
    const [amountTon, setAmountTon] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleWithdraw = async () => {
        setError("");
        const nanotons = parseTonInputToNanotons(amountTon);
        if (!nanotons || nanotons < MIN_AMOUNT_NANOTONS) {
            setError(`Минимальная сумма — ${MIN_AMOUNT_TON} TON`);
            soundEngine.playActionError();
            return;
        }
        if (nanotons > balanceNanotons) {
            setError("Недостаточно средств на балансе");
            soundEngine.playActionError();
            return;
        }
        if (!userFriendlyAddress) {
            setError("Подключите TON кошелёк для вывода");
            soundEngine.playActionError();
            return;
        }

        setIsSubmitting(true);
        setStep("confirming");
        soundEngine.playActionConfirm();

        try {
            await requestWithdrawal(nanotons.toString());
            await onBalanceRefresh();
            setStep("success");
            soundEngine.playActionSuccess();
        } catch (e: any) {
            setStep("amount");
            setError(e?.message || "Ошибка при выводе. Попробуйте ещё раз.");
            soundEngine.playActionError();
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Step: Amount Input ──
    if (step === "amount") {
        return (
            <div className="space-y-5">
                <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto mb-3">
                        <ArrowDownCircle className="text-rose-400" size={28} />
                    </div>
                    <h2 className="text-xl font-black text-white">Вывести средства</h2>
                    <p className="text-sm text-white/40 mt-1">На подключённый кошелёк</p>
                </div>

                {/* Amount */}
                <div>
                    <label className="text-xs text-white/50 uppercase font-bold block mb-2">Сумма (TON)</label>
                    <div className="relative">
                        <input
                            type="number"
                            inputMode="decimal"
                            value={amountTon}
                            onChange={e => { setAmountTon(e.target.value); setError(""); }}
                            onFocus={e => bringFocusedInputIntoView(e.currentTarget)}
                            placeholder="0.5"
                            min={MIN_AMOUNT_TON}
                            step={AMOUNT_INPUT_STEP_TON}
                            className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white font-mono text-lg placeholder:text-white/20 focus:outline-none focus:border-rose-400/50 pr-16"
                            style={{ fontSize: 16 }}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 font-bold text-sm">TON</span>
                    </div>
                    <button
                        onClick={() => {
                            soundEngine.playUiClick();
                            setAmountTon(formatNanotonsForInput(balanceNanotons, 2));
                        }}
                        className="mt-1.5 ml-1 text-xs text-cyan-400/70 hover:text-cyan-400 transition-colors"
                    >
                        Всё ({formatNanotonsBalance(balanceNanotons)})
                    </button>
                </div>

                {/* Balance */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between">
                    <span className="text-xs text-white/40 uppercase font-bold">Доступно</span>
                    <span className="font-mono font-black text-emerald-400">{formatNanotonsBalance(balanceNanotons)}</span>
                </div>

                {/* Destination wallet */}
                <div className="!mt-8">
                    <label className="text-xs text-white/50 uppercase font-bold block mb-2">Адрес получателя</label>
                    {userFriendlyAddress ? (
                        <div className="bg-black/40 border border-white/10 rounded-xl p-3 flex items-center gap-2">
                            <Wallet size={14} className="text-cyan-400 shrink-0" />
                            <span className="text-xs text-white/70 font-mono truncate">
                                {userFriendlyAddress.slice(0, 4)}…{userFriendlyAddress.slice(-4)}
                            </span>
                            <span className="ml-auto text-[10px] text-emerald-400 font-bold uppercase shrink-0">Ваш кошелёк</span>
                        </div>
                    ) : (
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2">
                            <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                            <p className="text-xs text-amber-300">
                                Подключите TON кошелёк в шапке приложения — средства будут выведены на него.
                            </p>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                        <AlertCircle size={14} className="shrink-0" />
                        {error}
                    </div>
                )}

                <button
                    onClick={handleWithdraw}
                    disabled={!userFriendlyAddress || !amountTon || isSubmitting}
                    className="!mt-8 w-full py-4 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 font-black text-white text-base shadow-lg shadow-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 active:scale-95 transition-all"
                >
                    {!userFriendlyAddress ? "Подключите кошелёк" : "Вывести"}
                </button>
            </div>
        );
    }

    // ── Step: Confirming ──
    if (step === "confirming") {
        return (
            <div
                className="flex flex-col items-center justify-center space-y-4 py-6"
                style={{ minHeight: DEPOSIT_STATUS_MIN_HEIGHT }}
            >
                <Loader2 className="text-rose-400 animate-spin" size={48} />
                <p className="text-white font-bold text-lg">Обрабатываем вывод…</p>
                <p className="text-white/40 text-sm text-center">Средства поступят в течение нескольких минут</p>
            </div>
        );
    }

    // ── Step: Success ──
    return (
        <div
            className="flex flex-col items-center justify-center space-y-5 py-6"
            style={{ minHeight: DEPOSIT_STATUS_MIN_HEIGHT }}
        >
            <motion.div
                initial={{ scale: 0.84, opacity: 0.3 }}
                animate={{ scale: 1 }}
                transition={SUCCESS_ICON_TRANSITION}
            >
                <CheckCircle2 className="text-emerald-400" size={64} />
            </motion.div>
            <div className="text-center space-y-2">
                <p className="text-white font-black text-2xl">Запрос принят!</p>
                <p className="text-white/50 text-sm">Средства поступят на ваш кошелёк в ближайшее время</p>
            </div>
        </div>
    );
}

// ─── Main Modal ────────────────────────────────────────────────────────────────

export function PaymentModal({
    mode,
    isOpen,
    onClose,
    serverUserId,
    balanceNanotons,
    onBalanceRefresh
}: PaymentModalProps) {
    const [keyboardInset, setKeyboardInset] = useState(0);
    const baseViewportHeightRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setKeyboardInset(0);
            baseViewportHeightRef.current = null;
            return;
        }

        const viewport = window.visualViewport;
        baseViewportHeightRef.current = viewport?.height ?? window.innerHeight;

        if (!viewport) return;

        const updateKeyboardInset = () => {
            const baseHeight = baseViewportHeightRef.current ?? window.innerHeight;
            const nextInset = Math.max(0, Math.round(baseHeight - viewport.height - viewport.offsetTop));
            setKeyboardInset(nextInset);

            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLInputElement && activeElement.closest(".payment-modal-card")) {
                bringFocusedInputIntoView(activeElement);
            }
        };

        updateKeyboardInset();
        viewport.addEventListener("resize", updateKeyboardInset);
        viewport.addEventListener("scroll", updateKeyboardInset);

        return () => {
            viewport.removeEventListener("resize", updateKeyboardInset);
            viewport.removeEventListener("scroll", updateKeyboardInset);
        };
    }, [isOpen]);

    return (
        <AnimatePresence mode="wait" initial={false}>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={MODAL_BACKDROP_TRANSITION}
                    className="payment-modal-overlay focus-blur-keep absolute inset-0 z-[80] bg-black/85 backdrop-blur-md flex items-end justify-center p-0"
                    onClick={() => {
                        soundEngine.playUiClick();
                        onClose();
                    }}
                >
                    <motion.div
                        initial={{ y: 44, opacity: 0, scale: 0.98 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 40, opacity: 0, scale: 0.985 }}
                        transition={MODAL_SHEET_TRANSITION}
                        className="payment-modal-card bg-gradient-to-b from-slate-900 to-teal-950 border-x border-b border-white/10 border-t-0 rounded-t-3xl w-full sm:max-w-sm p-6 shadow-2xl relative min-h-[68svh] max-h-[95svh] overflow-y-auto"
                        style={{
                            paddingBottom: `calc(1.5rem + env(safe-area-inset-bottom) + ${keyboardInset}px)`,
                            maxHeight: `calc(95svh - ${keyboardInset}px)`,
                            minHeight: keyboardInset > 0 ? undefined : "68svh"
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Drag handle (mobile) */}
                        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />

                        {/* Close button */}
                        <button
                            onClick={() => {
                                soundEngine.playUiClick();
                                onClose();
                            }}
                            className="absolute top-5 right-5 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all duration-200 ease-out active:scale-95"
                        >
                            <X size={16} />
                        </button>

                        {mode === "deposit" ? (
                            <DepositFlow
                                serverUserId={serverUserId}
                                balanceNanotons={balanceNanotons}
                                onBalanceRefresh={onBalanceRefresh}
                                onClose={onClose}
                            />
                        ) : (
                            <WithdrawFlow
                                balanceNanotons={balanceNanotons}
                                onBalanceRefresh={onBalanceRefresh}
                            />
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
