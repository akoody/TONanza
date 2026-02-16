import { GameStatus, Prisma, PrismaClient } from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";
import { AppError } from "../shared/errors.js";
import { toJsonSafe } from "../shared/json.js";
import {
  buildRoundProof,
  deriveWinningTicket,
  generateServerSeed,
  hashSeed
} from "./provably-fair.js";

const SERVICE_FEE_BPS = 500n; // 5% fee in basis points.
const BPS_DIVISOR = 10_000n;
const GAME_LOCK_KEY = 7_407_026;

type LockedUserRow = {
  id: bigint;
  balance_nanotons: bigint;
};

type LockedGameRow = {
  id: bigint;
  status: GameStatus;
  total_pot_nanotons: bigint;
  next_ticket: bigint;
  ends_at: Date;
  server_seed: string;
  server_seed_hash: string;
};

type TxClient = Prisma.TransactionClient;

export class GameService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: {
      roundDurationSeconds: number;
      io?: SocketIOServer;
    }
  ) {}

  async ensureOpenGameExists() {
    return this.prisma.$transaction(
      async (tx) => {
        // Advisory lock prevents creating two OPEN rounds concurrently.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${GAME_LOCK_KEY})`;

        const existingOpenGame = await tx.game.findFirst({
          where: { status: GameStatus.OPEN },
          orderBy: { id: "desc" }
        });

        if (existingOpenGame) {
          return existingOpenGame;
        }

        const now = new Date();
        const endsAt = new Date(now.getTime() + this.options.roundDurationSeconds * 1000);
        const serverSeed = generateServerSeed();
        const serverSeedHash = hashSeed(serverSeed);

        return tx.game.create({
          data: {
            serverSeed,
            serverSeedHash,
            endsAt,
            status: GameStatus.OPEN,
            totalPotNanotons: 0n,
            commission: 0n,
            nextTicket: 1n
          }
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );
  }

  async getActiveGamePublicView() {
    const game = await this.prisma.game.findFirst({
      where: { status: GameStatus.OPEN },
      orderBy: { id: "desc" },
      select: {
        id: true,
        serverSeedHash: true,
        status: true,
        totalPotNanotons: true,
        nextTicket: true,
        endsAt: true,
        startsAt: true
      }
    });

    return game;
  }

  async placeBet(userId: bigint, amountNanotons: bigint) {
    if (amountNanotons <= 0n) {
      throw new AppError(400, "amountNanotons must be a positive bigint string");
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const [lockedGame] = await tx.$queryRaw<LockedGameRow[]>(Prisma.sql`
          SELECT id, status, total_pot_nanotons, next_ticket, ends_at, server_seed, server_seed_hash
          FROM games
          WHERE status = 'OPEN'
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE
        `);

        if (!lockedGame) {
          throw new AppError(409, "No active round found");
        }

        if (lockedGame.ends_at <= new Date()) {
          throw new AppError(409, "Round is closing, try in the next round");
        }

        // FOR UPDATE ensures the same balance cannot be consumed twice in parallel requests.
        const [lockedUser] = await tx.$queryRaw<LockedUserRow[]>(Prisma.sql`
          SELECT id, balance_nanotons
          FROM users
          WHERE id = ${userId}
          FOR UPDATE
        `);

        if (!lockedUser) {
          throw new AppError(404, "User not found");
        }

        if (lockedUser.balance_nanotons < amountNanotons) {
          throw new AppError(400, "Insufficient balance");
        }

        // Ticket ranges are assigned from monotonically increasing next_ticket under row lock.
        const ticketStart = lockedGame.next_ticket;
        const ticketEnd = ticketStart + amountNanotons - 1n;

        await tx.user.update({
          where: { id: userId },
          data: {
            balanceNanotons: {
              decrement: amountNanotons
            }
          }
        });

        const bet = await tx.bet.create({
          data: {
            userId,
            gameId: lockedGame.id,
            amountNanotons,
            ticketStart,
            ticketEnd
          }
        });

        const updatedGame = await tx.game.update({
          where: { id: lockedGame.id },
          data: {
            totalPotNanotons: {
              increment: amountNanotons
            },
            nextTicket: ticketEnd + 1n
          }
        });

        return {
          betId: bet.id,
          userId,
          gameId: bet.gameId,
          amountNanotons: bet.amountNanotons,
          ticketStart: bet.ticketStart,
          ticketEnd: bet.ticketEnd,
          totalPotNanotons: updatedGame.totalPotNanotons,
          endsAt: updatedGame.endsAt
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000
      }
    );

    this.emit("game:betPlaced", result);
    return result;
  }

  async determineWinner(gameId: bigint, clientSeed: string) {
    if (!clientSeed || clientSeed.length < 16) {
      throw new AppError(400, "clientSeed is required and must be at least 16 chars");
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const [lockedGame] = await tx.$queryRaw<LockedGameRow[]>(Prisma.sql`
          SELECT id, status, total_pot_nanotons, next_ticket, ends_at, server_seed, server_seed_hash
          FROM games
          WHERE id = ${gameId}
          FOR UPDATE
        `);

        if (!lockedGame) {
          throw new AppError(404, "Game not found");
        }

        if (lockedGame.status !== GameStatus.OPEN) {
          throw new AppError(409, "Game is not open anymore");
        }

        if (lockedGame.ends_at > new Date()) {
          throw new AppError(409, "Round timer has not ended yet");
        }

        await tx.game.update({
          where: { id: gameId },
          data: { status: GameStatus.LOCKED }
        });

        const bets = await tx.bet.findMany({
          where: { gameId },
          orderBy: { ticketStart: "asc" }
        });

        if (bets.length === 0) {
          const cancelled = await tx.game.update({
            where: { id: gameId },
            data: {
              status: GameStatus.CANCELLED,
              clientSeed,
              commission: 0n,
              resolvedAt: new Date()
            }
          });

          return {
            status: cancelled.status,
            gameId: cancelled.id,
            winnerId: null,
            winningTicket: null,
            payoutNanotons: 0n,
            commissionNanotons: cancelled.commission,
            totalPotNanotons: cancelled.totalPotNanotons,
            proof: null
          };
        }

        const totalTickets = lockedGame.next_ticket - 1n;
        const winningTicket = deriveWinningTicket({
          serverSeed: lockedGame.server_seed,
          clientSeed,
          maxTicket: totalTickets
        });

        const winnerBet = bets.find(
          (bet) => bet.ticketStart <= winningTicket && bet.ticketEnd >= winningTicket
        );

        if (!winnerBet) {
          throw new AppError(500, "Winner ticket does not match any bet");
        }

        // Integer-only commission calculation avoids floating point rounding attacks.
        const commissionNanotons = (lockedGame.total_pot_nanotons * SERVICE_FEE_BPS) / BPS_DIVISOR;
        const payoutNanotons = lockedGame.total_pot_nanotons - commissionNanotons;

        const [winnerRow] = await tx.$queryRaw<LockedUserRow[]>(Prisma.sql`
          SELECT id, balance_nanotons
          FROM users
          WHERE id = ${winnerBet.userId}
          FOR UPDATE
        `);

        if (!winnerRow) {
          throw new AppError(500, "Winner user not found");
        }

        await tx.user.update({
          where: { id: winnerBet.userId },
          data: {
            balanceNanotons: {
              increment: payoutNanotons
            }
          }
        });

        const finished = await tx.game.update({
          where: { id: gameId },
          data: {
            status: GameStatus.FINISHED,
            clientSeed,
            winnerId: winnerBet.userId,
            commission: commissionNanotons,
            resolvedAt: new Date()
          }
        });

        const proof = buildRoundProof({
          serverSeed: lockedGame.server_seed,
          serverSeedHash: lockedGame.server_seed_hash,
          clientSeed,
          totalTickets,
          winningTicket
        });

        return {
          status: finished.status,
          gameId: finished.id,
          winnerId: winnerBet.userId,
          winnerBetId: winnerBet.id,
          winningTicket,
          payoutNanotons,
          commissionNanotons,
          totalPotNanotons: finished.totalPotNanotons,
          proof
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000
      }
    );

    this.emit("game:resolved", result);
    await this.ensureOpenGameExists();

    return result;
  }

  async getGameFairness(gameId: bigint) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        status: true,
        serverSeed: true,
        serverSeedHash: true,
        clientSeed: true,
        winnerId: true,
        totalPotNanotons: true,
        nextTicket: true,
        commission: true,
        resolvedAt: true
      }
    });

    if (!game) {
      throw new AppError(404, "Game not found");
    }

    const totalTickets = game.nextTicket > 0n ? game.nextTicket - 1n : 0n;
    const isResolved = game.status === GameStatus.FINISHED || game.status === GameStatus.CANCELLED;

    let winningTicket: bigint | null = null;
    if (game.status === GameStatus.FINISHED && game.clientSeed) {
      winningTicket = deriveWinningTicket({
        serverSeed: game.serverSeed,
        clientSeed: game.clientSeed,
        maxTicket: totalTickets
      });
    }

    return {
      ...game,
      serverSeed: isResolved ? game.serverSeed : null,
      totalTickets,
      winningTicket,
      verificationFormula: "winningTicket = (sha256(serverSeed:clientSeed) % totalTickets) + 1"
    };
  }

  private emit(event: string, payload: unknown) {
    this.options.io?.emit(event, toJsonSafe(payload));
  }
}
