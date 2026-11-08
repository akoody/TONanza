import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { GameService } from "../../src/game/game.service.js";
import { deriveWinningTicket } from "../../src/game/provably-fair.js";
import { balanceOf, createUser, prisma, resetDb, TON } from "./helpers.js";

const CLIENT_SEED = "1234:root-hash:file-hash";

const game = new GameService(prisma, {
  roundDurationSeconds: 40,
  rakeBps: 400,
  minBetNanotons: TON / 10n
});

beforeEach(async () => {
  await resetDb();
  await game.ensureOpenGameExists();
});

after(() => prisma.$disconnect());

const openGame = () => prisma.game.findFirstOrThrow({ where: { status: "OPEN" }, orderBy: { id: "desc" } });

async function expireRound(id: bigint) {
  await prisma.game.update({ where: { id }, data: { endsAt: new Date(Date.now() - 1000) } });
}

async function finishRound(bets: Array<[bigint, bigint]>) {
  for (const [userId, amount] of bets) {
    await game.placeBet(userId, amount);
  }
  const { id } = await openGame();
  await expireRound(id);
  return game.determineWinner(id, CLIENT_SEED);
}

async function makePrizeClaimable(id: bigint) {
  await prisma.game.update({ where: { id }, data: { resolvedAt: new Date(Date.now() - 60_000) } });
}

test("a bet debits the balance and takes a contiguous ticket range", async () => {
  const alice = await createUser(5n * TON);
  const bob = await createUser(5n * TON);

  const first = await game.placeBet(alice.id, TON);
  const second = await game.placeBet(bob.id, 2n * TON);

  assert.equal(await balanceOf(alice.id), 4n * TON);
  assert.equal(first.ticketStart, 1n);
  assert.equal(first.ticketEnd, TON);
  assert.equal(second.ticketStart, TON + 1n);
  assert.equal(second.totalPotNanotons, 3n * TON);
  assert.equal(first.countdownStarted, false);
  assert.equal(second.countdownStarted, true);
});

test("rejects bets below the minimum or above the balance and changes nothing", async () => {
  const alice = await createUser(TON);

  await assert.rejects(game.placeBet(alice.id, TON / 100n), /Minimum bet/);
  await assert.rejects(game.placeBet(alice.id, 2n * TON), /Insufficient funds/);

  assert.equal(await balanceOf(alice.id), TON);
  assert.equal((await openGame()).totalPotNanotons, 0n);
  assert.equal(await prisma.bet.count(), 0);
});

test("simultaneous bets from different players all succeed", async () => {
  const users = await Promise.all(Array.from({ length: 12 }, () => createUser(TON)));

  const results = await Promise.allSettled(users.map((user) => game.placeBet(user.id, TON)));

  assert.deepEqual(
    results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.code ?? (r as PromiseRejectedResult).reason)),
    []
  );
  const round = await openGame();
  assert.equal(round.totalPotNanotons, 12n * TON);
  assert.equal(round.nextTicket, 12n * TON + 1n);
});

test("parallel bets cannot spend the same balance twice", async () => {
  const alice = await createUser(TON);

  const results = await Promise.allSettled(Array.from({ length: 8 }, () => game.placeBet(alice.id, TON)));

  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await balanceOf(alice.id), 0n);
  assert.equal(await prisma.bet.count(), 1);
});

test("a sole player can cancel and gets everything back, a joined round cannot be cancelled", async () => {
  const alice = await createUser(5n * TON);
  const bob = await createUser(5n * TON);

  await game.placeBet(alice.id, TON);
  await game.placeBet(alice.id, TON);
  await assert.rejects(game.cancelSoloBet(bob.id), /sole participant/);

  const cancelled = await game.cancelSoloBet(alice.id);
  assert.equal(cancelled.refundedNanotons, 2n * TON);
  assert.equal(await balanceOf(alice.id), 5n * TON);
  assert.equal((await openGame()).nextTicket, 1n);

  await game.placeBet(alice.id, TON);
  await game.placeBet(bob.id, TON);
  await assert.rejects(game.cancelSoloBet(alice.id), /another player joined/);
});

test("a round cannot be resolved before its timer ends or twice", async () => {
  const alice = await createUser(5n * TON);
  const bob = await createUser(5n * TON);
  await game.placeBet(alice.id, TON);
  await game.placeBet(bob.id, TON);
  const { id } = await openGame();

  await assert.rejects(game.determineWinner(id, CLIENT_SEED), /timer has not ended/);
  await assert.rejects(game.determineWinner(id, "short"), /at least 16/);

  await expireRound(id);
  await game.determineWinner(id, CLIENT_SEED);
  await assert.rejects(game.determineWinner(id, CLIENT_SEED), /not open/);
});

test("the winner matches the published proof and the rake is taken once", async () => {
  const alice = await createUser(5n * TON);
  const bob = await createUser(5n * TON);

  const result = await finishRound([
    [alice.id, TON],
    [bob.id, 3n * TON]
  ]);

  const round = await prisma.game.findUniqueOrThrow({ where: { id: result.gameId } });
  const ticket = deriveWinningTicket({
    serverSeed: round.serverSeed,
    clientSeed: CLIENT_SEED,
    maxTicket: 4n * TON
  });
  assert.equal(result.winningTicket, ticket);
  assert.equal(result.winnerId, ticket <= TON ? alice.id : bob.id);
  assert.equal(result.commissionNanotons, (4n * TON * 400n) / 10_000n);
  assert.equal(result.payoutNanotons + result.commissionNanotons, 4n * TON);

  const fairness = await game.getGameFairness(result.gameId);
  assert.equal(fairness.serverSeed, round.serverSeed);
  assert.equal(fairness.winningTicket, ticket);
  assert.equal(fairness.clientSeedSource, "ton-masterchain");
});

test("the server seed stays hidden until the round is resolved", async () => {
  const { id } = await openGame();
  assert.equal((await game.getGameFairness(id)).serverSeed, null);
});

test("a new open round exists after resolution and only one is created in parallel", async () => {
  const alice = await createUser(5n * TON);
  const bob = await createUser(5n * TON);
  await finishRound([
    [alice.id, TON],
    [bob.id, TON]
  ]);
  await Promise.all(Array.from({ length: 5 }, () => game.ensureOpenGameExists()));

  assert.equal(await prisma.game.count({ where: { status: "OPEN" } }), 1);
});

test("the prize waits for the roulette and is paid exactly once", async () => {
  const alice = await createUser(5n * TON);
  const bob = await createUser(5n * TON);
  const result = await finishRound([
    [alice.id, TON],
    [bob.id, TON]
  ]);
  const winnerId = result.winnerId as bigint;
  const loserId = winnerId === alice.id ? bob.id : alice.id;
  const before = await balanceOf(winnerId);

  await assert.rejects(game.claimGamePrize(result.gameId, winnerId), /not available until/);
  await makePrizeClaimable(result.gameId);
  await assert.rejects(game.claimGamePrize(result.gameId, loserId), /Only the winner/);

  const claims = await Promise.allSettled([
    game.claimGamePrize(result.gameId, winnerId),
    game.claimGamePrize(result.gameId, winnerId),
    game.claimGamePrize(result.gameId, winnerId),
    game.settlePendingPrizesForUser(winnerId)
  ]);

  assert.equal(await balanceOf(winnerId), before + result.payoutNanotons, JSON.stringify(claims.map((c) => c.status)));
});

test("referrers and invitees get their share of the rake", async () => {
  const referrer = await createUser(0n);
  const invited = await createUser(20n * TON, { referrerId: referrer.id });
  const other = await createUser(20n * TON);

  await finishRound([
    [invited.id, 10n * TON],
    [other.id, 10n * TON]
  ]);

  const commission = (10n * TON * 400n) / 10_000n;
  const updatedReferrer = await prisma.user.findUniqueOrThrow({ where: { id: referrer.id } });
  const updatedInvited = await prisma.user.findUniqueOrThrow({ where: { id: invited.id } });
  assert.equal(updatedReferrer.referralBalanceNanotons, (commission * 15n) / 100n);
  assert.equal(updatedInvited.referralBalanceNanotons, (commission * 3n) / 100n);
});
