import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeChatDeleteAck,
  normalizeChatMessage,
  normalizeChatSendAck,
  normalizeChatStatusPayload
} from "../src/lib/chat-protocol.js";
import { restoreGameHistory, restoreWinners, winnersFromHistory } from "../src/lib/history-cache.js";
import {
  buildBetEventKey,
  createPlayersSignature,
  mapPlayersFromSnapshot,
  mergeLatestById
} from "../src/lib/round-snapshot.js";

const message = { id: "m1", userId: "42", username: "Ada", text: "hello", createdAt: 1_700_000_000_000 };

test("chat messages are validated and sanitised", () => {
  assert.equal(normalizeChatMessage(message)?.text, "hello");
  assert.equal(normalizeChatMessage({ ...message, username: "<b>Ada</b>" })?.username.includes("<"), false);
  assert.equal(normalizeChatMessage({ ...message, text: "   " }), null);
  assert.equal(normalizeChatMessage({ ...message, createdAt: "soon" }), null);
  assert.equal(normalizeChatMessage(null), null);
  assert.equal(normalizeChatMessage({ ...message, id: 5 }), null);
});

test("chat acknowledgements reject unknown shapes", () => {
  const ok = normalizeChatSendAck({ ok: true, message, nextMessageAtMs: 123.9 });
  assert.equal(ok?.ok && ok.nextMessageAtMs, 123);
  assert.equal(normalizeChatSendAck({ ok: true, message }), null);
  assert.equal((normalizeChatSendAck({ ok: false, code: "NOT_A_CODE", error: "x" }) as { code: string }).code, "INVALID_PAYLOAD");
  assert.equal(normalizeChatSendAck({ ok: "maybe" }), null);
  assert.equal(normalizeChatSendAck({ ok: false, code: "COOLDOWN", error: "wait" })?.ok, false);
  assert.equal(normalizeChatDeleteAck("nope"), null);
  assert.deepEqual(normalizeChatStatusPayload({ sendingEnabled: false }), { sendingEnabled: false });
  assert.equal(normalizeChatStatusPayload({ sendingEnabled: "no" }), null);
});

test("round snapshots drop empty stakes, sort by amount and sign consistently", () => {
  const raw = [
    { userId: "1", name: "A", amountNanotons: "100" },
    { userId: "2", name: "<B>", amountNanotons: "300" },
    { userId: "3", name: "C", amountNanotons: "0" }
  ];
  const players = mapPlayersFromSnapshot(raw as never);
  assert.deepEqual(players.map((p) => p.userId), ["2", "1"]);
  assert.equal(players[0]?.name.includes("<"), false);
  assert.equal(createPlayersSignature(raw as never), createPlayersSignature([...raw] as never));
  assert.notEqual(
    createPlayersSignature(raw as never),
    createPlayersSignature([{ ...raw[0], amountNanotons: "101" }, raw[1], raw[2]] as never)
  );
});

test("a bet event key identifies one bet", () => {
  const bet = { gameId: "1", userId: "2", amountNanotons: "3", ticketStart: "1", ticketEnd: "3" };
  assert.equal(buildBetEventKey(bet as never), buildBetEventKey({ ...bet } as never));
  assert.notEqual(buildBetEventKey(bet as never), buildBetEventKey({ ...bet, ticketStart: "4", ticketEnd: "6" } as never));
});

test("merge keeps the newest version of each entry", () => {
  const merged = mergeLatestById(
    [{ id: "a", timestamp: 1 }, { id: "b", timestamp: 5 }, { id: "a", timestamp: 9 }],
    (entry: { id: string }) => entry.id,
    10
  );
  assert.deepEqual(merged, [{ id: "a", timestamp: 9 }, { id: "b", timestamp: 5 }]);
});

test("cached history tolerates corrupted localStorage", () => {
  assert.deepEqual(restoreGameHistory(null), []);
  assert.deepEqual(restoreGameHistory("{not json"), []);
  assert.deepEqual(restoreGameHistory('{"a":1}'), []);

  const [game] = restoreGameHistory(
    JSON.stringify([{ gameId: "g", players: [{ userId: "1", name: "<x>", amountNanotons: "5" }], payoutNanotons: "bad", timestamp: 7 }])
  );
  assert.equal(game?.players[0]?.amountNanotons, 5n);
  assert.equal(game?.players[0]?.name.includes("<"), false);
  assert.equal(game?.payoutNanotons, 0n);
  assert.equal(winnersFromHistory(game ? [game] : [])[0]?.id, "g");
  assert.equal(restoreWinners('[{"id":"w","username":"A","payoutNanotons":"9","timestamp":1}]')[0]?.payoutNanotons, 9n);
});
