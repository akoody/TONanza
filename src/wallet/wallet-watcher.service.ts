import { DepositStatus, Prisma, PrismaClient } from "@prisma/client";
import TonWeb from "tonweb";
import { isPrismaUniqueViolation } from "../shared/errors.js";

type TonTx = {
  transaction_id?: {
    hash?: string;
    lt?: string;
  };
  in_msg?: {
    source?: string;
    destination?: string;
    value?: string;
    message?: string;
  };
};

type RegisterDepositInput = {
  txHash: string;
  amountNanotons: bigint;
  sourceAddress?: string;
  comment?: string;
  userId: bigint | null;
};

const isLikelyFriendlyTonAddress = (address: string): boolean => {
  return /^[A-Za-z0-9_-]{48}$/.test(address);
};

const isLikelyRawTonAddress = (address: string): boolean => {
  return /^(?:-1|0):[a-fA-F0-9]{64}$/.test(address);
};

const isWalletAddressConfigured = (address: string): boolean => {
  const normalized = address.trim();
  if (!normalized || normalized.includes("...")) {
    return false;
  }

  return isLikelyFriendlyTonAddress(normalized) || isLikelyRawTonAddress(normalized);
};

const normalizeToncenterRpcUrl = (inputUrl: string): string => {
  const normalized = inputUrl.trim().replace(/\/+$/, "");
  if (/\/jsonrpc$/i.test(normalized)) {
    return normalized;
  }

  if (/\/api\/v2$/i.test(normalized)) {
    return `${normalized}/jsonRPC`;
  }

  if (/\/api\/v2\//i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/api/v2/jsonRPC`;
};

const isJsonParseLikeError = (error: unknown): boolean => {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error &&
      (error.message.includes("Unexpected end of JSON input") ||
        error.message.includes("Unexpected token") ||
        error.message.includes("JSON")))
  );
};

export class WalletWatcherService {
  private readonly provider: {
    getTransactions: (
      address: string,
      limit: number,
      lt?: string,
      hash?: string,
      toLt?: string,
      archival?: boolean
    ) => Promise<TonTx[]>;
  };

  private intervalId: NodeJS.Timeout | null = null;
  private lastProcessedLt = 0n;
  private readonly walletAddress: string;
  private readonly enabled: boolean;
  private warnedInvalidJson = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: {
      walletAddress: string;
      toncenterBaseUrl: string;
      toncenterApiKey: string;
      pollIntervalMs: number;
    }
  ) {
    this.walletAddress = options.walletAddress.trim();
    this.enabled = isWalletAddressConfigured(this.walletAddress);

    const TonWebAny = TonWeb as unknown as {
      new (provider: unknown): { provider: WalletWatcherService["provider"] };
      HttpProvider: new (url: string, config?: { apiKey?: string }) => unknown;
    };

    const rpcUrl = normalizeToncenterRpcUrl(options.toncenterBaseUrl);
    const httpProvider = new TonWebAny.HttpProvider(rpcUrl, {
      apiKey: options.toncenterApiKey || undefined
    });

    this.provider = new TonWebAny(httpProvider).provider;
  }

  start() {
    if (this.intervalId) {
      return;
    }

    if (!this.enabled) {
      console.warn(
        "[wallet-watcher] disabled: APP_WALLET_ADDRESS is placeholder or invalid. Set a real TON address to enable deposits."
      );
      return;
    }

    this.runPollSafely();
    this.intervalId = setInterval(() => {
      this.runPollSafely();
    }, this.options.pollIntervalMs);
  }

  stop() {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  async pollOnce() {
    if (!this.enabled) {
      return;
    }

    let txs: TonTx[];
    try {
      txs = await this.provider.getTransactions(this.walletAddress, 30);
    } catch (error) {
      if (isJsonParseLikeError(error)) {
        if (!this.warnedInvalidJson) {
          console.warn(
            "[wallet-watcher] TON API returned invalid JSON. Check TONCENTER_BASE_URL (recommended: https://toncenter.com/api/v2/jsonRPC) and API availability."
          );
          this.warnedInvalidJson = true;
        }
        return;
      }

      throw error;
    }
    this.warnedInvalidJson = false;

    if (!Array.isArray(txs) || txs.length === 0) {
      return;
    }

    // TON API returns newest first. We process oldest first to keep lt monotonic.
    const ordered = [...txs].reverse();

    for (const tx of ordered) {
      const lt = this.parseLt(tx.transaction_id?.lt);
      if (lt <= this.lastProcessedLt) {
        continue;
      }

      await this.handleIncomingTx(tx);
      this.lastProcessedLt = lt;
    }
  }

  private runPollSafely() {
    void this.pollOnce().catch((error) => {
      console.error("Wallet watcher poll failed", error);
    });
  }

  private async handleIncomingTx(tx: TonTx) {
    const incoming = tx.in_msg;
    if (!incoming?.value || !incoming.destination) {
      return;
    }

    if (incoming.destination !== this.walletAddress) {
      return;
    }

    const amountNanotons = this.parseLt(incoming.value);
    if (amountNanotons <= 0n) {
      return;
    }

    const txHash = this.toTxHash(tx);
    const comment = incoming.message?.trim();
    const userId = this.extractUserId(comment);

    await this.registerDeposit({
      txHash,
      amountNanotons,
      sourceAddress: incoming.source,
      comment,
      userId
    });
  }

  private async registerDeposit(input: RegisterDepositInput) {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Unique tx_hash is idempotency key: same on-chain payment cannot be credited twice.
          await tx.deposit.create({
            data: {
              txHash: input.txHash,
              amountNanotons: input.amountNanotons,
              sourceAddress: input.sourceAddress,
              comment: input.comment,
              status: DepositStatus.PENDING
            }
          });

          if (!input.userId) {
            await tx.deposit.update({
              where: { txHash: input.txHash },
              data: {
                status: DepositStatus.FAILED,
                comment: this.markComment(input.comment, "failed:missing-user-id")
              }
            });
            return;
          }

          const [lockedUser] = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
            SELECT id
            FROM users
            WHERE id = ${input.userId}
            FOR UPDATE
          `);

          if (!lockedUser) {
            await tx.deposit.update({
              where: { txHash: input.txHash },
              data: {
                status: DepositStatus.FAILED,
                comment: this.markComment(input.comment, "failed:unknown-user")
              }
            });
            return;
          }

          await tx.user.update({
            where: { id: input.userId },
            data: {
              balanceNanotons: {
                increment: input.amountNanotons
              }
            }
          });

          await tx.deposit.update({
            where: { txHash: input.txHash },
            data: {
              userId: input.userId,
              status: DepositStatus.CONFIRMED,
              confirmedAt: new Date()
            }
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 12_000
        }
      );
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        return;
      }

      throw error;
    }
  }

  private toTxHash(tx: TonTx): string {
    const base64Hash = tx.transaction_id?.hash;
    if (!base64Hash) {
      const lt = tx.transaction_id?.lt ?? "0";
      return `fallback-lt-${lt}`;
    }

    return Buffer.from(base64Hash, "base64").toString("hex");
  }

  private parseLt(value: string | undefined): bigint {
    if (!value || !/^[0-9]+$/.test(value)) {
      return 0n;
    }

    return BigInt(value);
  }

  private extractUserId(comment?: string): bigint | null {
    if (!comment) {
      return null;
    }

    const match = comment.match(/(?:uid|user|tg)[:=]([0-9]{1,20})/i);
    if (!match?.[1]) {
      return null;
    }

    return BigInt(match[1]);
  }

  private markComment(comment: string | undefined, marker: string): string {
    const prepared = comment?.trim() || "";
    const joined = prepared ? `${prepared} [${marker}]` : `[${marker}]`;
    return joined.slice(0, 255);
  }
}
