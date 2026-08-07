import assert from "node:assert/strict";
import test from "node:test";
import { logRedactedError } from "~~/lib/security/redactedErrorLog";

function captureConsoleError(run: () => void) {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    run();
  } finally {
    console.error = original;
  }
  return lines;
}

test("a pg unique violation never leaks the conflicting value", () => {
  const error = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
    code: "23505",
    constraint: "users_email_key",
    detail: "Key (email)=(anna.mueller@example.de) already exists.",
    name: "error",
    table: "tokenless_better_auth_users",
  });

  const lines = captureConsoleError(() => logRedactedError("tokenless_api_unexpected_error", error));

  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0] ?? "", /anna\.mueller|example\.de|duplicate key|users_email_key/u);
  assert.deepEqual(Object.keys(JSON.parse(lines[0] ?? "{}")).sort(), ["errorCode", "errorDigest", "event"]);
  assert.match(lines[0] ?? "", /"event":"tokenless_api_unexpected_error"/u);
  assert.match(lines[0] ?? "", /"errorDigest":"sha256:[0-9a-f]{64}"/u);
});

test("the digest is stable for one failure and distinct across failures", () => {
  const [first] = captureConsoleError(() => logRedactedError("event", new TypeError("boom")));
  const [second] = captureConsoleError(() => logRedactedError("event", new TypeError("boom")));
  const [third] = captureConsoleError(() => logRedactedError("event", new TypeError("other")));

  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.match(first ?? "", /"errorCode":"TypeError"/u);
});

test("non-error throws are reported without their payload", () => {
  const lines = captureConsoleError(() => logRedactedError("event", { secret: "s3cr3t" }));

  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0] ?? "", /s3cr3t|secret/u);
  assert.match(lines[0] ?? "", /"errorCode":"unknown_error"/u);
});
