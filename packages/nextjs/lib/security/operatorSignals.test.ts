import { logOperatorAttention, logRedactedError } from "./redactedErrorLog";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

function capture(run: () => void) {
  const lines: string[] = [];
  const error = console.error;
  console.error = (line: string) => lines.push(line);
  try {
    run();
  } finally {
    console.error = error;
  }
  return lines.map(line => JSON.parse(line) as Record<string, unknown>);
}

test("every operator signal carries one field an alert rule can match", () => {
  // A log drain alerts on a field, not on prose. Eleven failure sites used three
  // different prefix conventions, so alerting meant a regex per message that
  // broke whenever somebody edited the wording — which is why the DPA's
  // "monitored operational failures" claim had nothing behind it.
  const [attention] = capture(() =>
    logOperatorAttention("stripe_webhook_needs_operator_attention", { eventId: "evt_1" }),
  );
  assert.equal(attention?.event, "stripe_webhook_needs_operator_attention");
  assert.equal(attention?.operatorAttention, true);
  assert.equal(attention?.eventId, "evt_1");

  const [failure] = capture(() =>
    logRedactedError("stripe_webhook_processing_failed", new TypeError("boom"), { eventId: "evt_2" }),
  );
  assert.equal(failure?.event, "stripe_webhook_processing_failed");
  assert.equal(failure?.errorCode, "TypeError");
  assert.equal(failure?.eventId, "evt_2");
});

test("the error payload never reaches the log, even with context attached", () => {
  // A pg unique violation puts the conflicting value in `detail`, and mail
  // transport errors carry the recipient address.
  const [line] = capture(() =>
    logRedactedError("settlement_notices_deferred", new Error("duplicate key: person@example.com"), {
      deliveryId: "dlv_1",
    }),
  );
  assert.doesNotMatch(JSON.stringify(line), /person@example\.com/u);
  assert.match(String(line?.errorDigest), /^sha256:[\da-f]{64}$/u);
});

test("no operator-actionable failure logs a bare string", () => {
  // Bare console.error in a failure path is the state this replaced. The
  // exceptions are deliberate and named rather than tolerated by omission.
  const allowed = new Set([
    "lib/home/socialProofServer.ts", // a marketing fetch; degrades to no social proof
    "lib/tokenless/agentProtocolObservability.ts", // emits its own already-structured line
    "lib/tokenless/scheduledMaintenance.ts", // cron surface, reported through its own response
  ]);
  const offenders: string[] = [];
  const walk = (dir: URL, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) {
        walk(child, `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (entry.name.includes(".test.")) continue;
      const path = `${prefix}${entry.name}`;
      if (allowed.has(path)) continue;
      const source = readFileSync(child, "utf8");
      for (const match of source.matchAll(/console\.error\(\s*"([^"]{0,120})"/gu)) {
        offenders.push(`${path}: ${match[1]}`);
      }
    }
  };
  walk(new URL("../../lib/", import.meta.url), "lib/");
  walk(new URL("../../app/", import.meta.url), "app/");
  assert.deepEqual(
    offenders,
    [],
    `these should use logRedactedError or logOperatorAttention:\n${offenders.join("\n")}`,
  );
});
