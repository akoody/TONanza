import { PrismaClient, WithdrawalStatus } from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";
import TonWeb from "tonweb";
import { mnemonicToPrivateKey } from "@ton/crypto";

export interface TonTransferRequest {
    toAddress: string;
    amountNanotons: bigint;
    seqno: number;
    /** Unix-время в секундах, после которого сообщение не может быть принято сетью. */
    expireAt: number;
}

export interface TonTransferClient {
    getSeqno(): Promise<number>;
    send(request: TonTransferRequest): Promise<void>;
}

type TransferOutcome = "sent" | "expired" | "unknown";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Выводы средств из горячего кошелька.
 *
 * Выводы идут строго по одному: кошелёк принимает только сообщение со следующим
 * seqno, и параллельные отправки с одним seqno сеть молча отбросила бы.
 *
 * Ответ API при отправке ничего не гарантирует: таймаут возможен и после того,
 * как сообщение ушло в сеть. Поэтому исход определяется по seqno кошелька:
 * вырос — перевод выполнен; не вырос после expireAt — сообщение уже не пройдёт
 * и средства можно вернуть; узнать не удалось — заявка остаётся в PROCESSING
 * на ручную проверку, автоматический возврат мог бы выплатить деньги дважды.
 */
export class PayoutService {
    private client: TonTransferClient | null;
    private queue: Promise<unknown> = Promise.resolve();
    private readonly messageTtlSeconds: number;
    private readonly confirmationMarginMs: number;
    private readonly seqnoPollMs: number;

    constructor(
        private readonly prisma: PrismaClient,
        private readonly options: {
            mnemonic: string;
            toncenterBaseUrl: string;
            toncenterApiKey: string;
            io?: SocketIOServer;
            notifyWithdrawalCompleted?: (input: { telegramId: bigint; amountNanotons: bigint }) => Promise<void> | void;
            transferClient?: TonTransferClient;
            messageTtlSeconds?: number;
            confirmationMarginMs?: number;
            seqnoPollMs?: number;
        }
    ) {
        this.client = options.transferClient ?? null;
        this.messageTtlSeconds = options.messageTtlSeconds ?? 60;
        this.confirmationMarginMs = options.confirmationMarginMs ?? 30_000;
        this.seqnoPollMs = options.seqnoPollMs ?? 3_000;
    }

    async init() {
        if (this.client) {
            return;
        }

        const words = this.options.mnemonic ? this.options.mnemonic.split(" ") : [];
        if (words.length < 12) {
            console.warn("[payout] Mnemonic not provided or invalid. Withdrawals disabled.");
            return;
        }

        let keyPair: Awaited<ReturnType<typeof mnemonicToPrivateKey>>;
        try {
            keyPair = await mnemonicToPrivateKey(words);
        } catch (e) {
            console.warn("[payout] Failed to derive key pair from mnemonic. Withdrawals disabled.", e);
            return;
        }

        const TonWebAny = TonWeb as any;
        const httpProvider = new TonWebAny.HttpProvider(this.options.toncenterBaseUrl, {
            apiKey: this.options.toncenterApiKey,
        });
        const tonweb = new TonWebAny(httpProvider);
        const WalletClass = tonweb.wallet.all["v4R2"];
        const wallet = new WalletClass(tonweb.provider, { publicKey: keyPair.publicKey });

        this.client = {
            getSeqno: async () => (await wallet.methods.seqno().call()) || 0,
            send: async ({ toAddress, amountNanotons, seqno, expireAt }) => {
                await wallet.methods.transfer({
                    secretKey: keyPair.secretKey,
                    toAddress,
                    amount: amountNanotons.toString(),
                    seqno,
                    expireAt,
                    payload: "TONanza Withdrawal",
                    sendMode: 3,
                }).send();
            },
        };

        const addr = await wallet.getAddress();
        console.log(`[payout] Wallet initialized: ${addr.toString(true, true, false)}`);
    }

    /** Ставит вывод в очередь; промис завершается, когда определён его исход. */
    processWithdrawal(withdrawalId: bigint): Promise<void> {
        const run = this.queue.then(() => this.execute(withdrawalId));
        this.queue = run.catch(() => undefined);
        return run;
    }

    private async execute(withdrawalId: bigint): Promise<void> {
        const claimed = await this.claimAndDebit(withdrawalId);
        if (!claimed) return;

        const { withdrawal, user } = claimed;
        this.emitBalance(user.id, user.balanceNanotons);

        if (!this.client) {
            console.error("[payout] Wallet not initialized, refunding user");
            await this.refund(withdrawal, "Withdrawals are disabled, refunded");
            return;
        }

        let seqno: number;
        try {
            seqno = await this.client.getSeqno();
        } catch (error) {
            // Отправки ещё не было: возврат безопасен.
            console.error("[payout] Failed to read wallet seqno", error);
            await this.refund(withdrawal, "Wallet unavailable, refunded");
            return;
        }

        const expireAt = Math.floor(Date.now() / 1000) + this.messageTtlSeconds;

        try {
            await this.client.send({
                toAddress: withdrawal.toAddress,
                amountNanotons: withdrawal.amountNanotons,
                seqno,
                expireAt,
            });
        } catch (error) {
            console.error("[payout] Broadcast reported an error, checking wallet state", error);
        }

        const outcome = await this.waitForOutcome(seqno, expireAt);

        if (outcome === "sent") {
            await this.prisma.withdrawal.update({
                where: { id: withdrawal.id },
                data: { status: WithdrawalStatus.BROADCASTED, notes: `Wallet seqno ${seqno}` },
            });
            await this.options.notifyWithdrawalCompleted?.({
                telegramId: user.telegramId,
                amountNanotons: withdrawal.amountNanotons,
            });
            return;
        }

        if (outcome === "expired") {
            await this.refund(withdrawal, "Transfer expired unsent, refunded");
            return;
        }

        console.error(`[payout] Withdrawal ${withdrawal.id} outcome unknown, manual review required`);
        await this.prisma.withdrawal.update({
            where: { id: withdrawal.id },
            data: { notes: `Outcome unknown at seqno ${seqno}, manual review required` },
        });
    }

    private async claimAndDebit(withdrawalId: bigint) {
        return this.prisma.$transaction(async (tx) => {
            const claimed = await tx.withdrawal.updateMany({
                where: { id: withdrawalId, status: WithdrawalStatus.PENDING },
                data: { status: WithdrawalStatus.PROCESSING, notes: null },
            });

            if (claimed.count === 0) {
                return null;
            }

            const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });

            // Условное списание исключает гонки и отрицательный баланс.
            const deducted = await tx.user.updateMany({
                where: { id: withdrawal.userId, balanceNanotons: { gte: withdrawal.amountNanotons } },
                data: { balanceNanotons: { decrement: withdrawal.amountNanotons } },
            });

            if (deducted.count === 0) {
                await tx.withdrawal.update({
                    where: { id: withdrawalId },
                    data: { status: WithdrawalStatus.FAILED, notes: "Insufficient balance at processing" },
                });
                return null;
            }

            const user = await tx.user.findUniqueOrThrow({
                where: { id: withdrawal.userId },
                select: { id: true, telegramId: true, balanceNanotons: true },
            });

            return { withdrawal, user };
        });
    }

    private async waitForOutcome(seqno: number, expireAt: number): Promise<TransferOutcome> {
        const deadline = expireAt * 1000 + this.confirmationMarginMs;
        let checkedAfterExpiry = false;

        for (;;) {
            try {
                const current = await this.client!.getSeqno();
                if (current > seqno) {
                    return "sent";
                }
                checkedAfterExpiry = Date.now() > expireAt * 1000;
            } catch (error) {
                console.warn("[payout] Failed to poll wallet seqno", error);
            }

            if (Date.now() >= deadline) {
                return checkedAfterExpiry ? "expired" : "unknown";
            }

            await sleep(this.seqnoPollMs);
        }
    }

    /** Возврат выполняется один раз: только при переходе из PROCESSING в FAILED. */
    private async refund(withdrawal: { id: bigint; userId: bigint; amountNanotons: bigint }, notes: string) {
        const balance = await this.prisma.$transaction(async (tx) => {
            const failed = await tx.withdrawal.updateMany({
                where: { id: withdrawal.id, status: WithdrawalStatus.PROCESSING },
                data: { status: WithdrawalStatus.FAILED, notes },
            });

            if (failed.count === 0) {
                return null;
            }

            const user = await tx.user.update({
                where: { id: withdrawal.userId },
                data: { balanceNanotons: { increment: withdrawal.amountNanotons } },
                select: { balanceNanotons: true },
            });

            return user.balanceNanotons;
        });

        if (balance !== null) {
            this.emitBalance(withdrawal.userId, balance);
        }
    }

    private emitBalance(userId: bigint, balanceNanotons: bigint) {
        this.options.io?.to(`user:${userId}`).emit("user:balance", balanceNanotons.toString());
    }
}
