import { formatFeedbackBonusUsdc } from "./FeedbackBonusAwardInbox";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Feedback Bonus inbox preserves the legacy human award interaction", () => {
  const source = readFileSync(new URL("./FeedbackBonusAwardInbox.tsx", import.meta.url), "utf8");
  const englishCatalog = readFileSync(new URL("../../../messages/en/agents.json", import.meta.url), "utf8");
  const localizedSource = `${source}\n${englishCatalog}`;
  assert.match(localizedSource, /Award Feedback Bonus/u);
  assert.match(localizedSource, /Award this feedback/u);
  assert.match(localizedSource, /eligible written feedback/u);
  assert.match(localizedSource, /The agent cannot make this decision/u);
  assert.match(localizedSource, /immutable\s+payout commitment/u);
  assert.match(localizedSource, /Connect awarder wallet/u);
  assert.match(source, /sendTransaction/u);
  assert.match(source, /human_wallet_required/u);
  assert.match(source, /method: "PUT"/u);
  assert.match(localizedSource, /Loading feedback bonuses/u);
  assert.match(localizedSource, /No feedback bonuses need an award/u);
  assert.ok(
    source.indexOf('prepared.status === "confirmed"') < source.indexOf("!account || !thirdwebBrowserClient"),
    "a confirmed idempotent replay must not require a connected wallet",
  );
  assert.doesNotMatch(source, /if \(!loaded \|\| \(items\.length === 0 && !error\)\) return null/u);
  assert.doesNotMatch(source, /auto(?:matic)? award/iu);
  assert.doesNotMatch(source, /payoutSalt|payoutAddress/u);
});

test("Feedback Bonus amounts use exact USDC atomic formatting", () => {
  assert.equal(formatFeedbackBonusUsdc("1"), "0.000001 USDC");
  assert.equal(formatFeedbackBonusUsdc("1250000"), "1.25 USDC");
});
