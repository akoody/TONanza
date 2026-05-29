import { DepositStatus, Prisma, PrismaClient } from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";
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

type IncomingDepositCandidate = {
  lt: bigint;
  txHash: string;
  amountNanotons: bigint;
  sourceAddress?: string;
  comment?: string;
  userId: bigint | null;
};

type WatcherCursor = {
  lt: bigint;
  txHash: string;
};

type ScanResult = {
  transactions: TonTx[];
  newestCursor: WatcherCursor | null;
  cursorReached: boolean;
};

type RegisterDepositResult =
  | {
    creditedUserId: bigint;
    telegramId: bigint;
    creditedAmountNanotons: bigint;
    updatedBalanceNanotons: bigint;
  }
  | null;

type WatcherStateRow = {
  id: number;
  wallet_address: string;
  last_seen_lt: bigint;
  last_seen_hash: string | null;
};

const MAX_DB_BIGINT = 9_223_372_036_854_775_807n;
const WATCHER_STATE_ID = 1;
const RETRY_BACKOFF_MS = [120, 350, 900] as const;

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

const wait = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

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
  private readonly walletAddress: string;
  private readonly enabled: boolean;
  private warnedInvalidJson = false;
  private isPolling = false;
  private readonly instanceId: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: {
      walletAddress: string;
      toncenterBaseUrl: string;
      toncenterApiKey: string;
      pollIntervalMs: number;
      pollBatchSize: number;
      pollMaxPages: number;
      catchupMaxPages: number;
      lockTtlMs: number;
      recoverFailedLimit: number;
      io?: SocketIOServer;
      notifyDepositCredited?: (input: { telegramId: bigint; amountNanotons: bigint }) => Promise<void> | void;
    }
  ) {
    this.walletAddress = options.walletAddress.trim();
    this.enabled = isWalletAddressConfigured(this.walletAddress);
    this.instanceId = `watcher-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

    const TonWebAny = TonWeb as unknown as {
      new(provider: unknown): { provider: WalletWatcherService["provider"] };
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

    await this.ensureWatcherState();

    const lockAcquired = await this.acquireLease();
    if (!lockAcquired) {
      return;
    }

    try {
      const previousCursor = await this.readCursor();
      const scan = await this.scanSinceCursor(previousCursor, this.options.pollMaxPages);

      let processingFailed = false;
      if (scan.transactions.length > 0) {
        processingFailed = await this.processTransactions(scan.transactions);
      }

      if (!scan.cursorReached && previousCursor) {
        console.warn(
          "[wallet-watcher] cursor not found in regular scan window. Running deep catch-up scan to avoid missed deposits."
        );

        const deepPages = Math.max(this.options.catchupMaxPages, this.options.pollMaxPages);
        if (deepPages > this.options.pollMaxPages) {
          const deepScan = await this.scanSinceCursor(previousCursor, deepPages);
          if (deepScan.transactions.length > 0) {
            const deepFailed = await this.processTransactions(deepScan.transactions);
            processingFailed = processingFailed || deepFailed;
          }
        }
      }

      await this.recoverFailedDeposits();

      if (!processingFailed && scan.newestCursor) {
        await this.updateCursor(scan.newestCursor);
      }
    } finally {
      await this.releaseLease();
    }
  }

  private runPollSafely() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    void this.pollOnce().catch((error) => {
      console.error("Wallet watcher poll failed", error);
    }).finally(() => {
      this.isPolling = false;
    });
  }

  private async processTransactions(txs: TonTx[]): Promise<boolean> {
    const candidates = this.collectIncomingCandidates(txs);
    if (candidates.length === 0) {
      return false;
    }

    const knownHashes = await this.loadExistingDepositHashes(candidates.map((candidate) => candidate.txHash));
    let hasFailures = false;

    for (const candidate of candidates) {
      if (knownHashes.has(candidate.txHash)) {
        continue;
      }

      console.log(
        `[wallet-watcher] Registering deposit: LT=${candidate.lt} Hash=${candidate.txHash} Amount=${candidate.amountNanotons} User=${candidate.userId}`
      );

      try {
        const result = await this.registerDepositWithRetry({
          txHash: candidate.txHash,
          amountNanotons: candidate.amountNanotons,
          sourceAddress: candidate.sourceAddress,
          comment: candidate.comment,
          userId: candidate.userId
        });

        knownHashes.add(candidate.txHash);

        if (result) {
          this.options.io?.to(`user:${result.creditedUserId}`).emit("user:balance", result.updatedBalanceNanotons.toString());
          await this.options.notifyDepositCredited?.({
            telegramId: result.telegramId,
            amountNanotons: result.creditedAmountNanotons
          });
        }
      } catch (error) {
        hasFailures = true;
        console.error("[wallet-watcher] Failed to register candidate transaction", {
          txHash: candidate.txHash,
          lt: candidate.lt.toString(),
          error
        });
      }
    }

    return hasFailures;
  }

  private async scanSinceCursor(cursor: WatcherCursor | null, maxPages: number): Promise<ScanResult> {
    const batchSize = Math.max(1, this.options.pollBatchSize);
    const pageLimit = Math.max(1, maxPages);
    const collected: TonTx[] = [];

    let beforeLt: string | undefined;
    let beforeHash: string | undefined;
    let cursorReached = cursor === null;

    try {
      console.log(
        `[wallet-watcher] Polling transactions for ${this.walletAddress} (batch=${batchSize}, pages=${pageLimit})...`
      );

      for (let page = 0; page < pageLimit; page += 1) {
        const txs = await this.provider.getTransactions(this.walletAddress, batchSize, beforeLt, beforeHash);
        if (!Array.isArray(txs) || txs.length === 0) {
          break;
        }

        for (const tx of txs) {
          const txCursor = this.getTxCursor(tx);
          if (cursor && txCursor && this.isCursorMatch(txCursor, cursor)) {
            cursorReached = true;
            break;
          }
          collected.push(tx);
        }

        if (cursorReached) {
          break;
        }

        if (txs.length < batchSize) {
          break;
        }

        const oldest = txs[txs.length - 1];
        if (!oldest) {
          break;
        }

        beforeLt = oldest.transaction_id?.lt;
        beforeHash = oldest.transaction_id?.hash;

        if (!beforeLt || !beforeHash) {
          break;
        }
      }
    } catch (error) {
      if (isJsonParseLikeError(error)) {
        if (!this.warnedInvalidJson) {
          console.warn(
            "[wallet-watcher] TON API returned invalid JSON. Check TONCENTER_BASE_URL (recommended: https://toncenter.com/api/v2/jsonRPC) and API availability."
          );
          this.warnedInvalidJson = true;
        }
        return {
          transactions: [],
          newestCursor: null,
          cursorReached
        };
      }

      console.error("[wallet-watcher] Poll error:", error);
      throw error;
    }

    this.warnedInvalidJson = false;

    const newestCursor = this.findNewestCursor(collected);
    console.log(
      `[wallet-watcher] Collected ${collected.length} new transaction(s), cursorReached=${cursorReached}`
    );

    return {
      transactions: collected,
      newestCursor,
      cursorReached
    };
  }

  private findNewestCursor(txs: TonTx[]): WatcherCursor | null {
    for (const tx of txs) {
      const cursor = this.getTxCursor(tx);
      if (cursor) {
        return cursor;
      }
    }
    return null;
  }

  private async registerDepositWithRetry(input: RegisterDepositInput): Promise<RegisterDepositResult> {
    let attempt = 0;

    while (true) {
      try {
        return await this.registerDeposit(input);
      } catch (error) {
        if (!this.isRetryableTransactionError(error) || attempt >= RETRY_BACKOFF_MS.length) {
          throw error;
        }

        const backoffMs = RETRY_BACKOFF_MS[attempt] ?? 1000;
        attempt += 1;
        console.warn(
          `[wallet-watcher] retrying registerDeposit for ${input.txHash} after transient error (attempt ${attempt}, backoff ${backoffMs}ms)`
        );
        await wait(backoffMs);
      }
    }
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === "P2034" || error.code === "P2028" || error.code === "P2024";
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("deadlock") ||
        message.includes("could not serialize") ||
        message.includes("timeout") ||
        message.includes("too many clients")
      );
    }

    return false;
  }

  private async registerDeposit(input: RegisterDepositInput): Promise<RegisterDepositResult> {
    try {
      return await this.prisma.$transaction(
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
            return null;
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
            return null;
          }

          const updatedUser = await tx.user.update({
            where: { id: input.userId },
            data: {
              balanceNanotons: {
                increment: input.amountNanotons
              }
            },
            select: {
              id: true,
              telegramId: true,
              balanceNanotons: true
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

          return {
            creditedUserId: updatedUser.id,
            telegramId: updatedUser.telegramId,
            creditedAmountNanotons: input.amountNanotons,
            updatedBalanceNanotons: updatedUser.balanceNanotons
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 12_000
        }
      );
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        return null;
      }

      throw error;
    }
  }

  private async recoverFailedDeposits() {
    const limit = Math.max(1, this.options.recoverFailedLimit);

    const failedRows = await this.prisma.$queryRaw<Array<{ id: bigint; comment: string | null }>>(Prisma.sql`
      SELECT id, comment
      FROM deposits
      WHERE status = ${DepositStatus.FAILED}::"DepositStatus"
        AND user_id IS NULL
        AND comment IS NOT NULL
        AND (
          comment LIKE '%[failed:unknown-user]%'
          OR comment LIKE '%[failed:missing-user-id]%'
        )
      ORDER BY created_at ASC
      LIMIT ${limit}
    `);

    if (failedRows.length === 0) {
      return;
    }

    for (const row of failedRows) {
      const userId = this.extractUserId(row.comment ?? undefined);
      if (!userId) {
        continue;
      }

      const recovered = await this.prisma.$transaction(async (tx) => {
        const [lockedDeposit] = await tx.$queryRaw<Array<{
          id: bigint;
          comment: string | null;
          amount_nanotons: bigint;
          user_id: bigint | null;
          status: string;
        }>>(Prisma.sql`
          SELECT id, comment, amount_nanotons, user_id, status
          FROM deposits
          WHERE id = ${row.id}
          FOR UPDATE
        `);

        if (!lockedDeposit) {
          return null;
        }

        if (lockedDeposit.status !== DepositStatus.FAILED || lockedDeposit.user_id !== null) {
          return null;
        }

        const [lockedUser] = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
          SELECT id
          FROM users
          WHERE id = ${userId}
          FOR UPDATE
        `);

        if (!lockedUser) {
          return null;
        }

        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            balanceNanotons: {
              increment: lockedDeposit.amount_nanotons
            }
          },
          select: {
            id: true,
            telegramId: true,
            balanceNanotons: true
          }
        });

        await tx.deposit.update({
          where: { id: lockedDeposit.id },
          data: {
            userId,
            status: DepositStatus.CONFIRMED,
            confirmedAt: new Date(),
            comment: this.markComment(this.clearFailureMarkers(lockedDeposit.comment), "recovered:auto")
          }
        });

        return {
          id: updatedUser.id,
          telegramId: updatedUser.telegramId,
          balanceNanotons: updatedUser.balanceNanotons,
          amountNanotons: lockedDeposit.amount_nanotons
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 12_000
      }).catch((error) => {
        if (this.isRetryableTransactionError(error)) {
          return null;
        }
        throw error;
      });

      if (recovered) {
        console.log(`[wallet-watcher] Recovered failed deposit ${row.id.toString()} for user ${recovered.id.toString()}`);
        this.options.io?.to(`user:${recovered.id}`).emit("user:balance", recovered.balanceNanotons.toString());
        await this.options.notifyDepositCredited?.({
          telegramId: recovered.telegramId,
          amountNanotons: recovered.amountNanotons
        });
      }
    }
  }

  private areAddressesEqual(a: string, b: string): boolean {
    try {
      const Address = (TonWeb as any).Address;
      const addrA = new Address(a);
      const addrB = new Address(b);
      return addrA.toString(false) === addrB.toString(false);
    } catch {
      return a.trim().toLowerCase() === b.trim().toLowerCase();
    }
  }

  private buildIncomingCandidate(tx: TonTx): IncomingDepositCandidate | null {
    const incoming = tx.in_msg;
    if (!incoming?.value || !incoming.destination) {
      return null;
    }

    if (!this.areAddressesEqual(incoming.destination, this.walletAddress)) {
      return null;
    }

    const amountNanotons = this.parseLt(incoming.value);
    if (amountNanotons <= 0n || amountNanotons > MAX_DB_BIGINT) {
      return null;
    }

    const txHash = this.toTxHash(tx);
    const comment = incoming.message?.trim();
    const userId = this.extractUserId(comment);
    const lt = this.parseLt(tx.transaction_id?.lt);
    if (lt <= 0n) {
      return null;
    }

    return {
      lt,
      txHash,
      amountNanotons,
      sourceAddress: incoming.source,
      comment,
      userId
    };
  }

  private collectIncomingCandidates(txs: TonTx[]): IncomingDepositCandidate[] {
    const parsed = txs
      .map((tx) => this.buildIncomingCandidate(tx))
      .filter((candidate): candidate is IncomingDepositCandidate => candidate !== null)
      .sort((left, right) => (left.lt < right.lt ? -1 : left.lt > right.lt ? 1 : 0));

    const seenTxHashes = new Set<string>();
    const deduplicated: IncomingDepositCandidate[] = [];

    for (const candidate of parsed) {
      if (seenTxHashes.has(candidate.txHash)) {
        continue;
      }
      seenTxHashes.add(candidate.txHash);
      deduplicated.push(candidate);
    }

    return deduplicated;
  }

  private async loadExistingDepositHashes(txHashes: string[]): Promise<Set<string>> {
    const uniqueTxHashes = [...new Set(txHashes)];
    if (uniqueTxHashes.length === 0) {
      return new Set<string>();
    }

    const existing = await this.prisma.deposit.findMany({
      where: {
        txHash: {
          in: uniqueTxHashes
        }
      },
      select: {
        txHash: true
      }
    });

    return new Set(existing.map((row) => row.txHash));
  }

  private async ensureWatcherState() {
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO watcher_state (id, wallet_address, last_seen_lt, created_at, updated_at)
      VALUES (${WATCHER_STATE_ID}, ${this.walletAddress}, 0, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    const [state] = await this.prisma.$queryRaw<WatcherStateRow[]>(Prisma.sql`
      SELECT id, wallet_address, last_seen_lt, last_seen_hash
      FROM watcher_state
      WHERE id = ${WATCHER_STATE_ID}
      LIMIT 1
    `);

    if (!state) {
      throw new Error("watcher_state row is missing");
    }

    const configuredWallet = state.wallet_address.trim();
    if (!configuredWallet) {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE watcher_state
        SET wallet_address = ${this.walletAddress}, updated_at = NOW()
        WHERE id = ${WATCHER_STATE_ID}
      `);
      return;
    }

    if (!this.areAddressesEqual(configuredWallet, this.walletAddress)) {
      throw new Error(
        `[wallet-watcher] watcher_state is bound to another wallet (${configuredWallet}). Check APP_WALLET_ADDRESS.`
      );
    }
  }

  private async acquireLease(): Promise<boolean> {
    const leaseUntil = new Date(Date.now() + this.options.lockTtlMs);

    const claimed = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE watcher_state
      SET lock_owner = ${this.instanceId},
          lock_expires_at = ${leaseUntil},
          updated_at = NOW()
      WHERE id = ${WATCHER_STATE_ID}
        AND wallet_address = ${this.walletAddress}
        AND (
          lock_owner IS NULL
          OR lock_expires_at IS NULL
          OR lock_expires_at < NOW()
          OR lock_owner = ${this.instanceId}
        )
    `);

    return claimed > 0;
  }

  private async releaseLease() {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE watcher_state
      SET lock_owner = NULL,
          lock_expires_at = NULL,
          updated_at = NOW()
      WHERE id = ${WATCHER_STATE_ID}
        AND lock_owner = ${this.instanceId}
    `);
  }

  private async readCursor(): Promise<WatcherCursor | null> {
    const [state] = await this.prisma.$queryRaw<WatcherStateRow[]>(Prisma.sql`
      SELECT id, wallet_address, last_seen_lt, last_seen_hash
      FROM watcher_state
      WHERE id = ${WATCHER_STATE_ID}
      LIMIT 1
    `);

    if (!state || state.last_seen_lt <= 0n || !state.last_seen_hash) {
      return null;
    }

    return {
      lt: state.last_seen_lt,
      txHash: state.last_seen_hash
    };
  }

  private async updateCursor(cursor: WatcherCursor) {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE watcher_state
      SET last_seen_lt = ${cursor.lt},
          last_seen_hash = ${cursor.txHash},
          updated_at = NOW()
      WHERE id = ${WATCHER_STATE_ID}
        AND wallet_address = ${this.walletAddress}
        AND (
          last_seen_lt < ${cursor.lt}
          OR (last_seen_lt = ${cursor.lt} AND (last_seen_hash IS NULL OR last_seen_hash <> ${cursor.txHash}))
        )
    `);
  }

  private getTxCursor(tx: TonTx): WatcherCursor | null {
    const lt = this.parseLt(tx.transaction_id?.lt);
    if (lt <= 0n) {
      return null;
    }

    const txHash = this.toTxHash(tx);
    return {
      lt,
      txHash
    };
  }

  private isCursorMatch(left: WatcherCursor, right: WatcherCursor): boolean {
    return left.lt === right.lt && left.txHash === right.txHash;
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

    const match = comment.match(/(?:uid|user|tg)[:=]\s*([0-9]{1,20})/i);
    if (!match?.[1]) {
      return null;
    }

    const parsed = BigInt(match[1]);
    if (parsed <= 0n || parsed > MAX_DB_BIGINT) {
      return null;
    }

    return parsed;
  }

  private clearFailureMarkers(comment: string | null): string {
    if (!comment) {
      return "";
    }

    return comment
      .replace(/\s*\[failed:[^\]]+\]/gi, "")
      .trim();
  }

  private markComment(comment: string | undefined | null, marker: string): string {
    const prepared = comment?.trim() || "";
    const joined = prepared ? `${prepared} [${marker}]` : `[${marker}]`;
    return joined.slice(0, 255);
  }
}
