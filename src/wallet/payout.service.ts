import { PrismaClient, WithdrawalStatus } from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";
import TonWeb from "tonweb";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { AppError } from "../shared/errors.js";

export class PayoutService {
    private wallet: any;
    private keyPair: any;

    constructor(
        private readonly prisma: PrismaClient,
        private readonly options: {
            mnemonic: string;
            toncenterBaseUrl: string;
            toncenterApiKey: string;
            io?: SocketIOServer;
            notifyWithdrawalCompleted?: (input: { telegramId: bigint; amountNanotons: bigint }) => Promise<void> | void;
        }
    ) { }

    async init() {
        if (!this.options.mnemonic || this.options.mnemonic.split(" ").length < 12) {
            console.warn("[payout] Mnemonic not provided or invalid. Withdrawals disabled.");
            return;
        }

        try {
            // @ton/crypto returns { secretKey, publicKey }
            const keyPair = await mnemonicToPrivateKey(this.options.mnemonic.split(" "));
            this.keyPair = {
                publicKey: keyPair.publicKey,
                secretKey: keyPair.secretKey
            };
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
        this.wallet = new WalletClass(tonweb.provider, {
            publicKey: this.keyPair.publicKey,
        });

        const addr = await this.wallet.getAddress();
        console.log(`[payout] Wallet initialized: ${addr.toString(true, true, false)}`);
    }

    async processWithdrawal(withdrawalId: bigint) {
        const result = await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.withdrawal.updateMany({
                where: {
                    id: withdrawalId,
                    status: WithdrawalStatus.PENDING
                },
                data: {
                    status: WithdrawalStatus.PROCESSING,
                    notes: null
                }
            });

            if (claimed.count === 0) {
                return null;
            }

            const withdrawal = await tx.withdrawal.findUnique({
                where: { id: withdrawalId }
            });

            if (!withdrawal || withdrawal.status !== WithdrawalStatus.PROCESSING) {
                return null;
            }

            // Atomic guarded decrement prevents race conditions and negative balances.
            const deducted = await tx.user.updateMany({
                where: {
                    id: withdrawal.userId,
                    balanceNanotons: {
                        gte: withdrawal.amountNanotons
                    }
                },
                data: {
                    balanceNanotons: {
                        decrement: withdrawal.amountNanotons
                    }
                }
            });

            if (deducted.count === 0) {
                // Insufficient funds at processing time -> mark FAILED
                await tx.withdrawal.update({
                    where: { id: withdrawalId },
                    data: { status: WithdrawalStatus.FAILED, notes: "Insufficient balance at processing" }
                });
                return null;
            }

            const updatedUser = await tx.user.findUnique({
                where: { id: withdrawal.userId },
                select: {
                    id: true,
                    telegramId: true,
                    balanceNanotons: true
                }
            });

            if (!updatedUser) {
                await tx.withdrawal.update({
                    where: { id: withdrawalId },
                    data: { status: WithdrawalStatus.FAILED, notes: "User not found at processing" }
                });
                return null;
            }

            return { withdrawal, user: updatedUser };
        });

        if (!result) return; // Already processed or failed

        // Notify user of deduction
        if (this.options.io) {
            this.options.io.to(`user:${result.user.id}`).emit("user:balance", result.user.balanceNanotons.toString());
        }

        if (!this.wallet) {
            // Should not happen if init was called, but if it does, we must refund
            console.error("[payout] Wallet not initialized, refunding user");
            await this.refundUser(result.withdrawal.id, result.withdrawal.userId, result.withdrawal.amountNanotons);
            return;
        }

        try {
            const seqno = (await this.wallet.methods.seqno().call()) || 0;

            const transfer = this.wallet.methods.transfer({
                secretKey: this.keyPair.secretKey,
                toAddress: result.withdrawal.toAddress,
                amount: result.withdrawal.amountNanotons.toString(),
                seqno: seqno,
                payload: "TONanza Withdrawal",
                sendMode: 3,
            });

            await transfer.send();

            await this.prisma.withdrawal.update({
                where: { id: withdrawalId },
                data: {
                    status: WithdrawalStatus.BROADCASTED,
                    txHash: "broadcast-" + Date.now()
                }
            });

            await this.options.notifyWithdrawalCompleted?.({
                telegramId: result.user.telegramId,
                amountNanotons: result.withdrawal.amountNanotons
            });

            return { ok: true };
        } catch (e: any) {
            console.error("Payout broadcast failed", e);
            await this.refundUser(withdrawalId, result.withdrawal.userId, result.withdrawal.amountNanotons);
            throw new AppError(500, "Withdrawal broadcast failed");
        }
    }

    private async refundUser(withdrawalId: bigint, userId: bigint, amount: bigint) {
        await this.prisma.$transaction([
            this.prisma.withdrawal.update({
                where: { id: withdrawalId },
                data: { status: WithdrawalStatus.FAILED, notes: "Broadcast failed, refunded" }
            }),
            this.prisma.user.update({
                where: { id: userId },
                data: { balanceNanotons: { increment: amount } }
            })
        ]);

        const updatedUser = await this.prisma.user.findUnique({ where: { id: userId } });
        if (updatedUser && this.options.io) {
            this.options.io.to(`user:${updatedUser.id}`).emit("user:balance", updatedUser.balanceNanotons.toString());
        }
    }
}
