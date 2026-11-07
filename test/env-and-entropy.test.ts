import assert from "node:assert/strict";
import test from "node:test";

// config/env.js разбирает process.env при импорте: задаём минимум до импорта.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.APP_WALLET_ADDRESS ??= "EQ_test";

const { devToolsEnabled, parseEnv } = await import("../src/config/env.js");
const { TonEntropyService, clientSeedSource } = await import("../src/wallet/ton-entropy.service.js");

const base = { DATABASE_URL: "postgresql://x", APP_WALLET_ADDRESS: "EQ_x" };

test("dev tools are off unless explicitly enabled in development", () => {
  assert.equal(devToolsEnabled(parseEnv({ ...base })), false);
  assert.equal(devToolsEnabled(parseEnv({ ...base, NODE_ENV: "development" })), false);
  assert.equal(devToolsEnabled(parseEnv({ ...base, NODE_ENV: "test", DEV_TOOLS_ENABLED: "true" })), false);
  assert.equal(
    devToolsEnabled(parseEnv({ ...base, NODE_ENV: "development", DEV_TOOLS_ENABLED: "true" })),
    true
  );
});

test("production refuses to start with dev tools or without a bot token", () => {
  assert.throws(
    () => parseEnv({ ...base, NODE_ENV: "production", DEV_TOOLS_ENABLED: "true", TELEGRAM_BOT_TOKEN: "t" }),
    /dev tools cannot be enabled in production/
  );
  assert.throws(() => parseEnv({ ...base, NODE_ENV: "production" }), /TELEGRAM_BOT_TOKEN is required/);
  assert.doesNotThrow(() => parseEnv({ ...base, NODE_ENV: "production", TELEGRAM_BOT_TOKEN: "t" }));
});

test("client seed comes from the TON masterchain block when the API answers", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({ ok: true, result: { last: { seqno: 7, root_hash: "r", file_hash: "f" } } }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );
  const seed = await new TonEntropyService("https://toncenter.test/api/v2", "").getClientSeed();
  assert.equal(seed, "7:r:f");
  assert.equal(clientSeedSource(seed), "ton-masterchain");
});

test("a server-generated fallback seed is marked as such", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("down", { status: 503 }));
  const seed = await new TonEntropyService("https://toncenter.test/api/v2", "").getClientSeed();
  assert.match(seed, /^fallback:[0-9a-f]{64}$/);
  assert.equal(clientSeedSource(seed), "server-fallback");
  assert.equal(clientSeedSource(null), null);
});
