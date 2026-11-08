import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { claimReferralBalance } from "../../src/referrals/referral.service.js";
import { PayoutService, type TonTransferClient, type TonTransferRequest } from "../../src/wallet/payout.service.js";
import { balanceOf, createUser, prisma, resetDb, TON } from "./helpers.js";

beforeEach(resetDb);
after(() => prisma.$disconnect());

class FakeTon implements TonTransferClient {
  seqno = 5;
  sent: TonTransferRequest[] = [];
  seqnoErrors = 0;
  /** Что делает сеть при отправке. */
  behaviour: "deliver" | "drop" | "timeout-after-delivery" | "reject" = "deliver";

  async getSeqno() {
    if (this.seqnoErrors > 0) {
      this.seqnoErrors -= 1;
      throw new Error("toncenter 503");
    }
    return this.seqno;
  }

  async send(request: TonTransferRequest) {
    if (request.seqno !== this.seqno) {
      return; // сеть молча отбрасывает сообщение с неверным seqno
    }
    this.sent.push(request);
    if (this.behaviour === "reject") throw new Error("rejected");
    if (this.behaviour === "drop") return;
    this.seqno += 1;
    if (this.behaviour === "timeout-after-delivery") throw new Error("ETIMEDOUT");
  }
}

function payouts(ton: TonTransferClient, overrides = {}) {
  const originalError = console.error;
  console.error = () => {};
  after(() => {
    console.error = originalError;
  });
  return new PayoutService(prisma, {
    mnemonic: "",
    toncenterBaseUrl: "http://ton.test",
    toncenterApiKey: "",
    transferClient: ton,
    messageTtlSeconds: 0,
    confirmationMarginMs: 1100,
    seqnoPollMs: 5,
    ...overrides
  });
}

async function withdrawal(userId: bigint, amountNanotons = TON) {
  return prisma.withdrawal.create({
    data: { userId, amountNanotons, toAddress: "EQ_destination", status: "PENDING" }
  });
}

const statusOf = async (id: bigint) => (await prisma.withdrawal.findUniqueOrThrow({ where: { id } })).status;

test("referral balance is credited once under parallel claims", async () => {
  const user = await createUser(0n, { referralBalanceNanotons: TON });

  const results = await Promise.allSettled(Array.from({ length: 6 }, () => claimReferralBalance(prisma, user.id)));

  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await balanceOf(user.id), TON);
  await assert.rejects(claimReferralBalance(prisma, user.id), /No referral balance/);
});

test("a delivered withdrawal debits the balance and becomes BROADCASTED", async () => {
  const ton = new FakeTon();
  const user = await createUser(3n * TON);
  const { id } = await withdrawal(user.id);

  await payouts(ton).processWithdrawal(id);

  assert.equal(await statusOf(id), "BROADCASTED");
  assert.equal(await balanceOf(user.id), 2n * TON);
  assert.equal(ton.sent[0]?.amountNanotons, TON);
});

test("processing a withdrawal twice pays once", async () => {
  const ton = new FakeTon();
  const user = await createUser(3n * TON);
  const { id } = await withdrawal(user.id);
  const service = payouts(ton);

  await Promise.all([service.processWithdrawal(id), service.processWithdrawal(id)]);

  assert.equal(ton.sent.length, 1);
  assert.equal(await balanceOf(user.id), 2n * TON);
});

test("parallel withdrawals use consecutive seqnos and none is lost", async () => {
  const ton = new FakeTon();
  const user = await createUser(10n * TON);
  const service = payouts(ton);
  const ids = await Promise.all([1, 2, 3, 4].map(() => withdrawal(user.id)));

  await Promise.all(ids.map(({ id }) => service.processWithdrawal(id)));

  assert.deepEqual(ton.sent.map((m) => m.seqno), [5, 6, 7, 8]);
  for (const { id } of ids) assert.equal(await statusOf(id), "BROADCASTED");
});

test("a timeout after delivery does not refund the user", async () => {
  const ton = new FakeTon();
  ton.behaviour = "timeout-after-delivery";
  const user = await createUser(3n * TON);
  const { id } = await withdrawal(user.id);

  await payouts(ton).processWithdrawal(id);

  assert.equal(await statusOf(id), "BROADCASTED");
  assert.equal(await balanceOf(user.id), 2n * TON);
});

for (const behaviour of ["reject", "drop"] as const) {
  test(`a transfer that never lands is refunded after it expires (${behaviour})`, async () => {
    const ton = new FakeTon();
    ton.behaviour = behaviour;
    const user = await createUser(3n * TON);
    const { id } = await withdrawal(user.id);

    await payouts(ton).processWithdrawal(id);

    assert.equal(await statusOf(id), "FAILED");
    assert.equal(await balanceOf(user.id), 3n * TON);
  });
}

test("no refund while the outcome is unknown", async () => {
  const ton = new FakeTon();
  ton.behaviour = "drop";
  const user = await createUser(3n * TON);
  const { id } = await withdrawal(user.id);
  // Первый запрос seqno проходит, все последующие падают: исход узнать нельзя.
  ton.getSeqno = (() => {
    let calls = 0;
    return async () => {
      calls += 1;
      if (calls > 1) throw new Error("toncenter down");
      return 5;
    };
  })();
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await payouts(ton).processWithdrawal(id);
  } finally {
    console.warn = originalWarn;
  }

  const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "PROCESSING");
  assert.match(row.notes ?? "", /manual review/);
  assert.equal(await balanceOf(user.id), 2n * TON);
});

test("refunds at once when the wallet is unreachable before sending", async () => {
  const ton = new FakeTon();
  ton.seqnoErrors = 1;
  const user = await createUser(3n * TON);
  const { id } = await withdrawal(user.id);

  await payouts(ton).processWithdrawal(id);

  assert.equal(await statusOf(id), "FAILED");
  assert.equal(await balanceOf(user.id), 3n * TON);
  assert.equal(ton.sent.length, 0);
});

test("a withdrawal above the balance fails without touching it", async () => {
  const ton = new FakeTon();
  const user = await createUser(TON / 2n);
  const { id } = await withdrawal(user.id, TON);

  await payouts(ton).processWithdrawal(id);

  assert.equal(await statusOf(id), "FAILED");
  assert.equal(await balanceOf(user.id), TON / 2n);
  assert.equal(ton.sent.length, 0);
});
