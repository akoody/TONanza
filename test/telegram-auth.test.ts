import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { validateTelegramWebAppData } from "../src/shared/telegram-auth.js";

const BOT_TOKEN = "123456:TEST-token";
const user = { id: 42, first_name: "Ada" };

function sign(params: Record<string, string>, token = BOT_TOKEN): string {
  const search = new URLSearchParams(params);
  const dataCheckString = [...search.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  search.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return search.toString();
}

const now = () => Math.floor(Date.now() / 1000);

test("accepts init data signed with the bot token", () => {
  const initData = sign({ auth_date: String(now()), user: JSON.stringify(user), query_id: "q" });
  const result = validateTelegramWebAppData(initData, BOT_TOKEN);
  assert.equal(result?.user.id, 42);
  assert.equal(result?.query_id, "q");
});

test("rejects data signed by another bot or tampered with", () => {
  const params = { auth_date: String(now()), user: JSON.stringify(user) };
  assert.equal(validateTelegramWebAppData(sign(params, "999:other"), BOT_TOKEN), null);

  const tampered = new URLSearchParams(sign(params));
  tampered.set("user", JSON.stringify({ ...user, id: 1 }));
  assert.equal(validateTelegramWebAppData(tampered.toString(), BOT_TOKEN), null);
});

test("rejects stale and future-dated init data", () => {
  const stale = sign({ auth_date: String(now() - 3600), user: JSON.stringify(user) });
  assert.equal(validateTelegramWebAppData(stale, BOT_TOKEN, 600), null);

  const future = sign({ auth_date: String(now() + 600), user: JSON.stringify(user) });
  assert.equal(validateTelegramWebAppData(future, BOT_TOKEN), null);
});

test("fails closed without a bot token or a valid user", () => {
  const initData = sign({ auth_date: String(now()), user: JSON.stringify(user) });
  assert.equal(validateTelegramWebAppData(initData, ""), null);
  assert.equal(validateTelegramWebAppData(sign({ auth_date: String(now()) }), BOT_TOKEN), null);
  assert.equal(
    validateTelegramWebAppData(sign({ auth_date: String(now()), user: "{bad" }), BOT_TOKEN),
    null
  );
  assert.equal(
    validateTelegramWebAppData(sign({ auth_date: String(now()), user: JSON.stringify({ id: -5 }) }), BOT_TOKEN),
    null
  );
});
