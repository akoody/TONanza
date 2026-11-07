import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildRoundProof,
  deriveWinningTicket,
  generateServerSeed,
  hashSeed
} from "../src/game/provably-fair.js";

test("server seeds are 32 random bytes and the published hash commits to them", () => {
  const seed = generateServerSeed();
  assert.match(seed, /^[0-9a-f]{64}$/);
  assert.notEqual(seed, generateServerSeed());
  assert.equal(hashSeed(seed), createHash("sha256").update(seed).digest("hex"));
});

test("winning ticket is reproducible from the revealed seeds", () => {
  const input = { serverSeed: "a".repeat(64), clientSeed: "123:root:file", maxTicket: 1000n };
  const digest = createHash("sha256").update(`${input.serverSeed}:${input.clientSeed}`).digest("hex");

  const ticket = deriveWinningTicket(input);

  assert.equal(ticket, (BigInt(`0x${digest}`) % 1000n) + 1n);
  assert.equal(deriveWinningTicket(input), ticket);
});

test("winning ticket always falls inside 1..maxTicket", () => {
  for (const maxTicket of [1n, 2n, 7n, 10_000_000_000n]) {
    for (let i = 0; i < 200; i += 1) {
      const ticket = deriveWinningTicket({
        serverSeed: generateServerSeed(),
        clientSeed: String(i),
        maxTicket
      });
      assert.ok(ticket >= 1n && ticket <= maxTicket, `ticket ${ticket} out of 1..${maxTicket}`);
    }
  }
});

test("changing either seed changes the outcome", () => {
  const base = { serverSeed: "s".repeat(64), clientSeed: "c", maxTicket: 1n << 64n };
  const ticket = deriveWinningTicket(base);
  assert.notEqual(deriveWinningTicket({ ...base, clientSeed: "c2" }), ticket);
  assert.notEqual(deriveWinningTicket({ ...base, serverSeed: "t".repeat(64) }), ticket);
});

test("rejects rounds without tickets", () => {
  assert.throws(() => deriveWinningTicket({ serverSeed: "s", clientSeed: "c", maxTicket: 0n }));
});

test("round proof carries everything needed to verify the result", () => {
  const serverSeed = generateServerSeed();
  const proof = buildRoundProof({
    serverSeed,
    serverSeedHash: hashSeed(serverSeed),
    clientSeed: "c",
    totalTickets: 50n,
    winningTicket: deriveWinningTicket({ serverSeed, clientSeed: "c", maxTicket: 50n })
  });
  assert.equal(hashSeed(proof.serverSeed), proof.serverSeedHash);
  assert.equal(
    deriveWinningTicket({ serverSeed: proof.serverSeed, clientSeed: proof.clientSeed, maxTicket: proof.totalTickets }),
    proof.winningTicket
  );
});
