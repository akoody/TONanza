import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { balanceOf, createUser, prisma, resetDb, TON } from "./helpers.js";

const BOT_TOKEN = "123456:HTTP-test-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.APP_WALLET_ADDRESS ??= "EQ_test";
process.env.NODE_ENV = "test";

const { buildApp } = await import("../../src/app.js");
type App = Awaited<ReturnType<typeof buildApp>>["app"];
let app: App;

function initData(telegramId: bigint | number) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(telegramId), first_name: "Test" })
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

const as = (telegramId: bigint) => ({ "x-telegram-init-data": initData(telegramId) });

before(async () => {
  ({ app } = await buildApp());
  await app.ready();
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(resetDb);

test("health and the public round are available without auth", async () => {
  assert.equal((await app.inject({ url: "/health" })).statusCode, 200);

  const round = await app.inject({ url: "/v1/games/active" });
  assert.equal(round.statusCode, 200);
  assert.equal(round.json().status, "OPEN");
  assert.equal("serverSeed" in round.json(), false);
});

test("responses carry security headers and unknown origins get no CORS grant", async () => {
  const res = await app.inject({ url: "/health", headers: { origin: "https://evil.example" } });
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

for (const [method, url] of [
  ["GET", "/v1/users/me"],
  ["GET", "/v1/payments/history"],
  ["GET", "/v1/referrals/info"],
  ["POST", "/v1/referrals/claim"],
  ["POST", "/v1/withdrawals"],
  ["POST", "/v1/bets"],
  ["POST", "/v1/bets/cancel"]
] as const) {
  test(`${method} ${url} requires Telegram auth`, async () => {
    const res = await app.inject({
      method,
      url,
      payload: method === "POST" ? { userId: "1", amountNanotons: "1000000000" } : undefined
    });
    assert.ok([400, 401].includes(res.statusCode), `status ${res.statusCode}`);
    assert.notEqual(res.statusCode, 200);
  });
}

test("dev bypass headers and top-up routes are off without dev tools", async () => {
  const user = await createUser(0n);

  const bypass = await app.inject({
    url: "/v1/users/me",
    headers: { "x-bypass-auth": "true", "x-dev-user-id": String(user.telegramId) }
  });
  assert.equal(bypass.statusCode, 401);

  const topUp = await app.inject({
    method: "POST",
    url: "/v1/dev/min-balance",
    payload: { userId: String(user.id), amountNanotons: "1000" }
  });
  assert.equal(topUp.statusCode, 404);
  assert.equal(await balanceOf(user.id), 0n);
});

test("sync always acts for the signed Telegram user, not the body", async () => {
  const victim = await createUser(5n * TON);

  const res = await app.inject({
    method: "POST",
    url: "/v1/users/sync",
    headers: as(777n),
    payload: { telegramId: String(victim.telegramId), walletAddress: `EQ${"A".repeat(46)}` }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().telegramId, "777");
  const untouched = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
  assert.equal(untouched.walletAddress, null);
});

test("a bet is placed for the signed user even if the body names another", async () => {
  const alice = await createUser(5n * TON);
  const bob = await createUser(5n * TON);
  await app.inject({ url: "/v1/games/active" });

  const res = await app.inject({
    method: "POST",
    url: "/v1/bets",
    headers: as(alice.telegramId),
    payload: { userId: String(bob.id), amountNanotons: String(TON) }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(await balanceOf(alice.id), 4n * TON);
  assert.equal(await balanceOf(bob.id), 5n * TON);
});

test("withdrawal needs a linked wallet and a sufficient balance", async () => {
  const noWallet = await createUser(5n * TON);
  const res = await app.inject({
    method: "POST",
    url: "/v1/withdrawals",
    headers: as(noWallet.telegramId),
    payload: { amountNanotons: String(TON) }
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /No wallet linked/);

  const poor = await createUser(TON, { walletAddress: "EQ_mine" });
  const tooMuch = await app.inject({
    method: "POST",
    url: "/v1/withdrawals",
    headers: as(poor.telegramId),
    payload: { amountNanotons: String(2n * TON) }
  });
  assert.match(tooMuch.json().message, /Insufficient balance/);

  const tiny = await app.inject({
    method: "POST",
    url: "/v1/withdrawals",
    headers: as(poor.telegramId),
    payload: { amountNanotons: "1000" }
  });
  assert.match(tiny.json().message, /Minimum withdrawal/);
});

test("payment history shows only the caller's operations", async () => {
  const alice = await createUser(0n);
  const bob = await createUser(0n);
  await prisma.deposit.create({ data: { userId: alice.id, txHash: "a", amountNanotons: TON, status: "CONFIRMED" } });
  await prisma.deposit.create({ data: { userId: bob.id, txHash: "b", amountNanotons: TON, status: "CONFIRMED" } });

  const res = await app.inject({ url: "/v1/payments/history", headers: as(alice.telegramId) });

  assert.deepEqual(res.json().map((row: { txHash: string }) => row.txHash), ["a"]);
});

test("referral claim moves the balance and reports an empty one", async () => {
  const user = await createUser(0n, { referralBalanceNanotons: TON });

  const claimed = await app.inject({ method: "POST", url: "/v1/referrals/claim", headers: as(user.telegramId) });
  assert.equal(claimed.json().balanceNanotons, String(TON));

  const again = await app.inject({ method: "POST", url: "/v1/referrals/claim", headers: as(user.telegramId) });
  assert.equal(again.statusCode, 400);
});

test("validation errors have a stable format", async () => {
  const user = await createUser(5n * TON);
  const res = await app.inject({
    method: "POST",
    url: "/v1/withdrawals",
    headers: as(user.telegramId),
    payload: { amountNanotons: "-5" }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().message, "Validation failed");
});
