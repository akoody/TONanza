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

const BPS_DIVISOR = 10_000n;
const GAME_LOCK_KEY = 7_407_026;
const MIN_PLAYERS_TO_START = 2;
const PARKED_ROUND_MS = 365 * 24 * 60 * 60 * 1000;
const NANOTONS_PER_TON = 1_000_000_000n;
const PRIZE_CLAIM_DELAY_MS = 14_000;

const formatTonAmount = (nanotons: bigint) => {
  const whole = nanotons / NANOTONS_PER_TON;
  const fraction = (nanotons % NANOTONS_PER_TON).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
};

type LockedUserRow = {
  id: bigint;
  balance_nanotons: bigint;
  telegram_id?: bigint;
};

type LockedGameRow = {
  id: bigint;
  status: GameStatus;
  total_pot_nanotons: bigint;
  next_ticket: bigint;
  starts_at: Date;
  ends_at: Date;
  server_seed: string;
  server_seed_hash: string;
};

type LockedClaimGameRow = {
  id: bigint;
  status: GameStatus;
  winner_id: bigint | null;
  total_pot_nanotons: bigint;
  commission: bigint;
  resolved_at: Date | null;
  prize_claimed_at: Date | null;
};

type PendingPrizeRow = {
  id: bigint;
  total_pot_nanotons: bigint;
  commission: bigint;
};

type PendingPrizeWinnerRow = {
  winner_id: bigint;
};

type LockedBetRow = {
  id: bigint;
  user_id: bigint;
  amount_nanotons: bigint;
  ticket_start: bigint;
  ticket_end: bigint;
};

type ParticipantRow = {
  user_id: bigint;
};

type TxClient = Prisma.TransactionClient;

export class GameService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: {
      roundDurationSeconds: number;
      rakeBps: number;
        minBetNanotons: bigint;
        io?: SocketIOServer;
        notifyPrizeClaimed?: (input: { telegramId: bigint; gameId: bigint }) => Promise<void> | void;
      }
  ) { }

  async broadcastGameState() {
    const game = await this.getActiveGamePublicView();
    if (game) {
      this.emit("game:state", game);
    }
  }

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
        const parkedUntil = new Date(now.getTime() + PARKED_ROUND_MS);
        const serverSeed = generateServerSeed();
        const serverSeedHash = hashSeed(serverSeed);

        return tx.game.create({
          data: {
            serverSeed,
            serverSeedHash,
            startsAt: parkedUntil,
            endsAt: parkedUntil,
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

    if (!game) {
      return null;
    }

    const participantCount = await this.countDistinctPlayers(this.prisma, game.id);
    const players = await this.getRoundPlayers(this.prisma, game.id);
    const bets = await this.getRoundBetEntries(this.prisma, game.id);
    const countdownStarted =
      this.isCountdownStarted(game.startsAt) && participantCount >= MIN_PLAYERS_TO_START;

    return {
      ...game,
      participantCount,
      countdownStarted,
      players,
      bets
    };
  }

  async placeBet(userId: bigint, amountNanotons: bigint) {
    if (amountNanotons <= 0n) {
      throw new AppError(400, "amountNanotons must be a positive bigint string");
    }
    if (amountNanotons < this.options.minBetNanotons) {
      throw new AppError(400, `Minimum bet is ${formatTonAmount(this.options.minBetNanotons)} TON`);
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const [lockedGame] = await tx.$queryRaw<LockedGameRow[]>(Prisma.sql`
          SELECT id, status, total_pot_nanotons, next_ticket, starts_at, ends_at, server_seed, server_seed_hash
          FROM games
          WHERE status = 'OPEN'
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE
        `);

        if (!lockedGame) {
          throw new AppError(409, "No active round found");
        }

        const now = new Date();
        const participantCountBefore = await this.countDistinctPlayers(tx, lockedGame.id);
        const countdownStarted =
          this.isCountdownStarted(lockedGame.starts_at, now) &&
          participantCountBefore >= MIN_PLAYERS_TO_START;

        if (countdownStarted && lockedGame.ends_at <= now) {
          throw new AppError(409, "Round is closing, try in the next round");
        }

        // Strict atomic balance update: decrement only if balance is sufficient.
        const balanceUpdateCount = await tx.$executeRaw(Prisma.sql`
          UPDATE users
          SET balance_nanotons = balance_nanotons - ${amountNanotons}
          WHERE id = ${userId} AND balance_nanotons >= ${amountNanotons}
        `);

        if (balanceUpdateCount === 0) {
          // check if user exists to distinguish between "not found" and "insufficient funds"
          const userExists = await tx.user.findUnique({ where: { id: userId } });
          if (!userExists) {
            throw new AppError(404, "User not found");
          }
          throw new AppError(400, "Insufficient funds");
        }

        // Ticket ranges are assigned from monotonically increasing next_ticket under row lock.
        const ticketStart = lockedGame.next_ticket;
        const ticketEnd = ticketStart + amountNanotons - 1n;

        const bet = await tx.bet.create({
          data: {
            userId,
            gameId: lockedGame.id,
            amountNanotons,
            ticketStart,
            ticketEnd
          }
        });

        const participantCount = await this.countDistinctPlayers(tx, lockedGame.id);
        const shouldStartCountdown = !countdownStarted && participantCount >= MIN_PLAYERS_TO_START;
        const startedAt = shouldStartCountdown ? now : undefined;
        const endsAt = shouldStartCountdown
          ? new Date(now.getTime() + this.options.roundDurationSeconds * 1000)
          : undefined;

        const updatedGame = await tx.game.update({
          where: { id: lockedGame.id },
          data: {
            totalPotNanotons: {
              increment: amountNanotons
            },
            nextTicket: ticketEnd + 1n,
            ...(startedAt && endsAt
              ? {
                startsAt: startedAt,
                endsAt
              }
              : {})
          }
        });

        // Get updated balance for response
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

        return {
          betId: bet.id,
          userId,
          gameId: bet.gameId,
          amountNanotons: bet.amountNanotons,
          ticketStart: bet.ticketStart,
          ticketEnd: bet.ticketEnd,
          totalPotNanotons: updatedGame.totalPotNanotons,
          userBalanceNanotons: user.balanceNanotons,
          participantCount,
          countdownStarted:
            this.isCountdownStarted(updatedGame.startsAt) &&
            participantCount >= MIN_PLAYERS_TO_START,
          endsAt: updatedGame.endsAt,
          username: user.username,
          avatarUrl: user.avatarUrl
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000
      }
    );

    this.emit("game:betPlaced", result);
    this.options.io?.to(`user:${userId}`).emit("user:balance", result.userBalanceNanotons.toString());
    return result;
  }

  async cancelSoloBet(userId: bigint) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const [lockedGame] = await tx.$queryRaw<LockedGameRow[]>(Prisma.sql`
          SELECT id, status, total_pot_nanotons, next_ticket, starts_at, ends_at, server_seed, server_seed_hash
          FROM games
          WHERE status = 'OPEN'
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE
        `);

        if (!lockedGame) {
          throw new AppError(409, "No active round found");
        }

        const participants = await tx.$queryRaw<ParticipantRow[]>(Prisma.sql`
          SELECT DISTINCT user_id
          FROM bets
          WHERE game_id = ${lockedGame.id}
          ORDER BY user_id ASC
        `);

        if (participants.length === 0) {
          throw new AppError(409, "No bets to cancel");
        }

        if (participants.length > 1) {
          throw new AppError(409, "Cannot cancel bet once another player joined");
        }

        const [soleParticipant] = participants;
        if (!soleParticipant || soleParticipant.user_id !== userId) {
          throw new AppError(403, "Only the sole participant can cancel a bet");
        }

        const [latestUserBet] = await tx.$queryRaw<LockedBetRow[]>(Prisma.sql`
          SELECT id, user_id, amount_nanotons, ticket_start, ticket_end
          FROM bets
          WHERE game_id = ${lockedGame.id} AND user_id = ${userId}
          ORDER BY ticket_start DESC
          LIMIT 1
          FOR UPDATE
        `);

        if (!latestUserBet) {
          throw new AppError(404, "Bet not found");
        }

        // --- NEW LOGIC: Cancel ALL bets for this user in this game ---
        const userBets = await tx.bet.findMany({
          where: {
            gameId: lockedGame.id,
            userId: userId
          }
        });

        if (userBets.length === 0) {
          throw new AppError(404, "No bets found to cancel");
        }

        const totalRefundAmount = userBets.reduce((sum, bet) => sum + bet.amountNanotons, 0n);

        // Verify total pot consistency (optional but good for safety)
        if (totalRefundAmount > lockedGame.total_pot_nanotons) {
          throw new AppError(500, "Game total pot is inconsistent with bet amount");
        }

        // Delete all bets
        await tx.bet.deleteMany({
          where: {
            gameId: lockedGame.id,
            userId: userId
          }
        });

        await tx.user.update({
          where: { id: userId },
          data: {
            balanceNanotons: {
              increment: totalRefundAmount
            }
          }
        });

        const participantCount = await this.countDistinctPlayers(tx, lockedGame.id);
        const shouldParkRound = participantCount === 0;
        const parkedUntil = shouldParkRound ? new Date(Date.now() + PARKED_ROUND_MS) : undefined;

        // We need to re-calculate next_ticket to fill the gaps or just leave gaps?
        // Simple approach: Decrement pot. Gaps in ticket ranges are technically fine as long as winning ticket logic handles it.
        // BUT current winning logic (deriveWinningTicket) assumes contiguous tickets 1..totalTickets.
        // If we leave gaps, we might pick a winning ticket that corresponds to no one (or a cancelled bet).
        // The implementation of determineWinner checks:
        // const winnerBet = bets.find((bet) => bet.ticketStart <= winningTicket && bet.ticketEnd >= winningTicket);
        // If we delete bets, there will be a gap. If winningTicket falls in gap -> House wins? Or re-roll?
        //
        // "Resetting" the round if it becomes empty is easy (nextTicket=1).
        // If other players exist, we must either:
        // A) Shift all subsequent tickets down (complex, heavy update).
        // B) Mark bets as "cancelled" but keep them in DB (and exclude from winning).
        //    If winning ticket hits a cancelled bet -> re-roll.
        // C) The user requirement says "cancel my bet".
        //    AND "Only the sole participant can cancel a bet" logic in line 283 suggests this checks if there are > 1 participants.

        // WAIT! Line 277: `if (participants.length > 1) { throw ... "Cannot cancel bet once another player joined" }`
        // THIS IS KEY. The current logic ONLY allows cancellation if the user is the ONLY player.
        // So we can safely RESET the game state (nextTicket = 1, totalPot = 0).

        const updatedGame = await tx.game.update({
          where: { id: lockedGame.id },
          data: {
            totalPotNanotons: 0n, // Since we are the only player and leaving, pot becomes 0
            nextTicket: 1n,       // Reset tickets
            ...(parkedUntil
              ? {
                startsAt: parkedUntil,
                endsAt: parkedUntil
              }
              : {})
          }
        });

        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

        return {
          cancelledBetIds: userBets.map(b => b.id),
          userId,
          gameId: lockedGame.id,
          refundedNanotons: totalRefundAmount,
          totalPotNanotons: updatedGame.totalPotNanotons,
          userBalanceNanotons: user.balanceNanotons,
          participantCount,
          countdownStarted: false, // Reset countdown since 0 players
          endsAt: updatedGame.endsAt
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000
      }
    );

    this.emit("game:betCancelled", result);
    this.options.io?.to(`user:${userId}`).emit("user:balance", result.userBalanceNanotons.toString());

    await this.broadcastGameState();

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
            resolvedAt: cancelled.resolvedAt,
            proof: null
          };
        }

        let expectedNextTicket = 1n;
        let totalBetsNanotons = 0n;
        for (const bet of bets) {
          if (bet.amountNanotons <= 0n) {
            throw new AppError(500, "Corrupted bet amount detected");
          }
          if (bet.ticketStart !== expectedNextTicket) {
            throw new AppError(500, "Ticket sequence is corrupted");
          }

          const expectedTicketEnd = bet.ticketStart + bet.amountNanotons - 1n;
          if (bet.ticketEnd !== expectedTicketEnd) {
            throw new AppError(500, "Ticket range is inconsistent with bet amount");
          }

          expectedNextTicket = bet.ticketEnd + 1n;
          totalBetsNanotons += bet.amountNanotons;
        }

        if (expectedNextTicket !== lockedGame.next_ticket) {
          throw new AppError(500, "Game next ticket is inconsistent with bet ranges");
        }
        if (totalBetsNanotons !== lockedGame.total_pot_nanotons) {
          throw new AppError(500, "Game total pot is inconsistent with aggregated bets");
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
        const commissionNanotons =
          (lockedGame.total_pot_nanotons * BigInt(this.options.rakeBps)) / BPS_DIVISOR;
        const payoutNanotons = lockedGame.total_pot_nanotons - commissionNanotons;

        // Group bets by userId to calculate individual stakes
        const userStakes = new Map<bigint, bigint>();
        for (const bet of bets) {
          const current = userStakes.get(bet.userId) || 0n;
          userStakes.set(bet.userId, current + bet.amountNanotons);
        }

        // Fetch user records to get their referrers
        const userIds = Array.from(userStakes.keys());
        const usersInRound = await tx.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, referrerId: true }
        });

        const userMap = new Map(usersInRound.map((u) => [u.id, u.referrerId]));

        // We will collect all referrer IDs to bulk fetch their referral counts
        const referrerIdsToFetch = new Set<bigint>();
        for (const [, referrerId] of userMap.entries()) {
          if (referrerId) {
            referrerIdsToFetch.add(referrerId);
          }
        }

        const referrerStats = new Map<bigint, number>();
        if (referrerIdsToFetch.size > 0) {
          const referrersGrouped = await tx.user.groupBy({
            by: ["referrerId"],
            where: { referrerId: { in: Array.from(referrerIdsToFetch) } },
            _count: { id: true }
          });
          for (const row of referrersGrouped) {
            if (row.referrerId) {
              referrerStats.set(row.referrerId, row._count.id);
            }
          }
        }

        // Calculate and aggregate all referral/rakeback payouts
        const referralBalanceUpdates = new Map<bigint, bigint>();
        const addUpdate = (uid: bigint, amount: bigint) => {
          if (amount <= 0n) return;
          const current = referralBalanceUpdates.get(uid) || 0n;
          referralBalanceUpdates.set(uid, current + amount);
        };

        for (const [userId, stake] of userStakes.entries()) {
          const referrerId = userMap.get(userId);
          if (!referrerId) continue;

          const baseCommissionFromUser = (stake * BigInt(this.options.rakeBps)) / BPS_DIVISOR;

          // 1. Calculate the Referrer's profit
          const friendCount = referrerStats.get(referrerId) || 0;
          let referrerPercent = 15n; // 1-5 friends
          if (friendCount >= 101) referrerPercent = 30n;
          else if (friendCount >= 26) referrerPercent = 25n;
          else if (friendCount >= 6) referrerPercent = 20n;

          const referrerReward = (baseCommissionFromUser * referrerPercent) / 100n;
          addUpdate(referrerId, referrerReward);

          // 2. Calculate the Invitee's rakeback
          let rakebackPercent = 0n;
          if (stake < 10n * NANOTONS_PER_TON) rakebackPercent = 2n;
          else if (stake < 50n * NANOTONS_PER_TON) rakebackPercent = 3n;
          else if (stake < 200n * NANOTONS_PER_TON) rakebackPercent = 4n;
          else rakebackPercent = 5n;

          const rakebackReward = (baseCommissionFromUser * rakebackPercent) / 100n;
          addUpdate(userId, rakebackReward);
        }

        // Apply all updates
        if (referralBalanceUpdates.size > 0) {
          for (const [uid, amountToAdd] of referralBalanceUpdates.entries()) {
            await tx.user.update({
              where: { id: uid },
              data: {
                referralBalanceNanotons: {
                  increment: amountToAdd
                }
              }
            });
          }
        }

        const resolvedAt = new Date();

        const finished = await tx.game.update({
          where: { id: gameId },
          data: {
            status: GameStatus.FINISHED,
            clientSeed,
            winnerId: winnerBet.userId,
            commission: commissionNanotons,
            resolvedAt,
            prizeClaimedAt: null
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
          resolvedAt: finished.resolvedAt,
          proof,
          wonRound: finished
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000
      }
    );

    this.emit("game:outcome", result);

    await this.ensureOpenGameExists();

    return result;
  }

  async settlePendingPrizesForUser(userId: bigint) {
    const claimableBefore = new Date(Date.now() - PRIZE_CLAIM_DELAY_MS);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const pendingGames = await tx.$queryRaw<PendingPrizeRow[]>(Prisma.sql`
          SELECT id, total_pot_nanotons, commission
          FROM games
          WHERE status = 'FINISHED'
            AND winner_id = ${userId}
            AND prize_claimed_at IS NULL
            AND resolved_at IS NOT NULL
            AND resolved_at <= ${claimableBefore}
          ORDER BY resolved_at ASC NULLS LAST, id ASC
          FOR UPDATE
        `);

        const [lockedUser] = await tx.$queryRaw<LockedUserRow[]>(Prisma.sql`
          SELECT id, balance_nanotons, telegram_id
          FROM users
          WHERE id = ${userId}
          FOR UPDATE
        `);

        if (!lockedUser) {
          throw new AppError(404, "User not found");
        }

        if (pendingGames.length === 0) {
          return {
            claimedGameIds: [] as bigint[],
            claimedAt: null as Date | null,
            claimedNanotons: 0n,
            balanceNanotons: lockedUser.balance_nanotons,
            telegramId: lockedUser.telegram_id ?? null
          };
        }

        let claimedNanotons = 0n;
        for (const game of pendingGames) {
          const payoutNanotons = game.total_pot_nanotons - game.commission;
          if (payoutNanotons > 0n) {
            claimedNanotons += payoutNanotons;
          }
        }

        let balanceNanotons = lockedUser.balance_nanotons;
        if (claimedNanotons > 0n) {
          const updatedUser = await tx.user.update({
            where: { id: userId },
            data: {
              balanceNanotons: {
                increment: claimedNanotons
              }
            },
            select: {
              balanceNanotons: true
            }
          });
          balanceNanotons = updatedUser.balanceNanotons;
        }

        const claimedAt = new Date();
        await tx.game.updateMany({
          where: {
            id: {
              in: pendingGames.map((game) => game.id)
            },
            prizeClaimedAt: null
          },
          data: {
            prizeClaimedAt: claimedAt
          }
        });

        return {
          claimedGameIds: pendingGames.map((game) => game.id),
          claimedAt,
          claimedNanotons,
          balanceNanotons,
          telegramId: lockedUser.telegram_id ?? null
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000
      }
    );

    if (result.claimedGameIds.length > 0) {
      this.options.io?.to(`user:${userId}`).emit("user:balance", result.balanceNanotons.toString());
      if (result.telegramId) {
        for (const claimedGameId of result.claimedGameIds) {
          await this.options.notifyPrizeClaimed?.({
            telegramId: result.telegramId,
            gameId: claimedGameId
          });
        }
      }
    }

    return result;
  }

  async settleMaturedPrizes(limit = 50) {
    const claimableBefore = new Date(Date.now() - PRIZE_CLAIM_DELAY_MS);
    const winners = await this.prisma.$queryRaw<PendingPrizeWinnerRow[]>(Prisma.sql`
      SELECT DISTINCT winner_id
      FROM games
      WHERE status = 'FINISHED'
        AND winner_id IS NOT NULL
        AND prize_claimed_at IS NULL
        AND resolved_at IS NOT NULL
        AND resolved_at <= ${claimableBefore}
      ORDER BY winner_id ASC
      LIMIT ${limit}
    `);

    for (const row of winners) {
      await this.settlePendingPrizesForUser(row.winner_id);
    }
  }

  async claimGamePrize(gameId: bigint, userId: bigint) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const [lockedGame] = await tx.$queryRaw<LockedClaimGameRow[]>(Prisma.sql`
          SELECT id, status, winner_id, total_pot_nanotons, commission, resolved_at, prize_claimed_at
          FROM games
          WHERE id = ${gameId}
          FOR UPDATE
        `);

        if (!lockedGame) {
          throw new AppError(404, "Game not found");
        }
        if (lockedGame.status !== GameStatus.FINISHED) {
          throw new AppError(409, "Prize can only be claimed for finished games");
        }
        if (!lockedGame.winner_id) {
          throw new AppError(409, "This game has no winner");
        }
        if (lockedGame.winner_id !== userId) {
          throw new AppError(403, "Only the winner can claim this prize");
        }

        const payoutNanotons = lockedGame.total_pot_nanotons - lockedGame.commission;
        if (payoutNanotons <= 0n) {
          throw new AppError(409, "This game has no claimable payout");
        }

        if (lockedGame.prize_claimed_at) {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { balanceNanotons: true }
          });
          if (!user) {
            throw new AppError(404, "User not found");
          }

          return {
            gameId,
            alreadyClaimed: true,
            claimedAt: lockedGame.prize_claimed_at,
            payoutNanotons,
            balanceNanotons: user.balanceNanotons
          };
        }

        if (!lockedGame.resolved_at || !this.isPrizeClaimAvailable(lockedGame.resolved_at)) {
          throw new AppError(409, "Prize is not available until the roulette finishes");
        }

        const [winnerRow] = await tx.$queryRaw<LockedUserRow[]>(Prisma.sql`
          SELECT id, balance_nanotons, telegram_id
          FROM users
          WHERE id = ${userId}
          FOR UPDATE
        `);
        if (!winnerRow) {
          throw new AppError(404, "Winner user not found");
        }

        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            balanceNanotons: {
              increment: payoutNanotons
            }
          },
          select: {
            balanceNanotons: true
          }
        });

        const claimedAt = new Date();
        await tx.$executeRaw(Prisma.sql`
          UPDATE games
          SET prize_claimed_at = ${claimedAt}
          WHERE id = ${gameId}
        `);

        return {
          gameId,
          alreadyClaimed: false,
          claimedAt,
          payoutNanotons,
          balanceNanotons: updatedUser.balanceNanotons,
          telegramId: winnerRow.telegram_id ?? null
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000
      }
    );

    if (!result.alreadyClaimed) {
      this.options.io?.to(`user:${userId}`).emit("user:balance", result.balanceNanotons.toString());
      this.emit("game:prizeClaimed", {
        gameId: result.gameId,
        userId,
        payoutNanotons: result.payoutNanotons
      });
      if (result.telegramId) {
        await this.options.notifyPrizeClaimed?.({
          telegramId: result.telegramId,
          gameId: result.gameId
        });
      }
    }

    return result;
  }

  private isPrizeClaimAvailable(resolvedAt: Date, now: Date = new Date()) {
    return resolvedAt.getTime() + PRIZE_CLAIM_DELAY_MS <= now.getTime();
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

  private isCountdownStarted(startsAt: Date, now = new Date()): boolean {
    return startsAt.getTime() <= now.getTime();
  }

  private async countDistinctPlayers(
    client: PrismaClient | Prisma.TransactionClient,
    gameId: bigint
  ): Promise<number> {
    const rows = await client.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT user_id)::bigint AS count
      FROM bets
      WHERE game_id = ${gameId}
    `);

    const rawCount = rows[0]?.count ?? 0;
    return Number(rawCount);
  }

  private async getRoundPlayers(
    client: PrismaClient | Prisma.TransactionClient,
    gameId: bigint
  ): Promise<Array<{ userId: bigint; amountNanotons: bigint; name: string; avatarUrl: string; color: string }>> {
    const grouped = await client.bet.groupBy({
      by: ["userId"],
      where: { gameId },
      _sum: {
        amountNanotons: true
      },
      orderBy: [{ _sum: { amountNanotons: "desc" } }, { userId: "asc" }]
    });

    if (grouped.length === 0) return [];

    const userIds = grouped.map((g) => g.userId);
    const users = await client.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, avatarUrl: true, telegramId: true }
    });

    const userMap = new Map(users.map((u) => [u.id.toString(), u]));

    return grouped
      .map((row) => {
        const user = userMap.get(row.userId.toString());
        const tId = user?.telegramId.toString() ?? row.userId.toString();
        // Fallback name logic if no username
        const displayName = user?.username
          ? user.username
          : `User #${tId.slice(-4)}`;

        return {
          userId: row.userId,
          amountNanotons: row._sum.amountNanotons ?? 0n,
          name: displayName,
          avatarUrl: user?.avatarUrl ?? "",
          color: "" // Assigned on frontend or we could generate consistent color here?
        };
      })
      .filter((row) => row.amountNanotons > 0n);
  }

  private async getRoundBetEntries(
    client: PrismaClient | Prisma.TransactionClient,
    gameId: bigint
  ): Promise<Array<{
    betId: bigint;
    userId: bigint;
    amountNanotons: bigint;
    createdAt: Date;
    username: string;
    avatarUrl: string;
  }>> {
    const bets = await client.bet.findMany({
      where: { gameId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        userId: true,
        amountNanotons: true,
        createdAt: true,
        user: {
          select: {
            username: true,
            avatarUrl: true,
            telegramId: true
          }
        }
      }
    });

    return bets.map((bet) => {
      const fallbackName = `User #${bet.user.telegramId.toString().slice(-4)}`;
      return {
        betId: bet.id,
        userId: bet.userId,
        amountNanotons: bet.amountNanotons,
        createdAt: bet.createdAt,
        username: bet.user.username || fallbackName,
        avatarUrl: bet.user.avatarUrl || ""
      };
    });
  }

  async getGameHistory(limit: number = 20) {
    const games = await this.prisma.game.findMany({
      where: { status: GameStatus.FINISHED },
      orderBy: { resolvedAt: "desc" },
      take: limit,
      include: {
        winner: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
            telegramId: true
          }
        },
        bets: {
          select: {
            userId: true,
            amountNanotons: true,
            user: {
              select: {
                username: true,
                avatarUrl: true,
                telegramId: true
              }
            }
          }
        }
      }
    });

    return games.map((game) => {
      // Calculate players for this game
      // We can reuse getRoundPlayers logic but optimized here since we have bets loaded
      // or just return simple stats. The frontend needs "players" array with amounts.
      // Let's aggregate bets in memory for these history items.

      const playerMap = new Map<string, { userId: string; amountNanotons: bigint; username: string; avatarUrl: string }>();
      for (const bet of game.bets) {
        const uid = bet.userId.toString();
        const current = playerMap.get(uid) || {
          userId: uid,
          amountNanotons: 0n,
          username: bet.user.username || `User #${bet.user.telegramId.toString().slice(-4)}`,
          avatarUrl: bet.user.avatarUrl || ""
        };
        current.amountNanotons += bet.amountNanotons;
        playerMap.set(uid, current);
      }

      const players = Array.from(playerMap.values());
      const winnerName = game.winner?.username || (game.winner ? `User #${game.winner.telegramId.toString().slice(-4)}` : "Unknown");

      return {
        gameId: game.id.toString(),
        winnerId: game.winnerId?.toString() || null,
        winnerName,
        winnerAvatarUrl: game.winner?.avatarUrl,
        totalPotNanotons: game.totalPotNanotons.toString(),
        payoutNanotons: (game.totalPotNanotons - game.commission).toString(),
        resolvedAt: game.resolvedAt,
        players: players.map(p => ({
          userId: p.userId,
          name: p.username,
          avatarUrl: p.avatarUrl,
          amountNanotons: p.amountNanotons.toString()
        }))
      };
    });
  }
}
