import assert from "node:assert/strict";
import test from "node:test";
import { publicAuthRouteError } from "~~/lib/auth/publicRouteError";
import { AuthError } from "~~/lib/auth/session";

test("public auth route errors preserve intentional denials and redact unexpected failures", () => {
  assert.deepEqual(
    publicAuthRouteError(new AuthError("Reauthenticate.", 401), {
      event: "test_auth_failure",
      fallbackMessage: "Unavailable.",
      fallbackStatus: 503,
    }),
    { message: "Reauthenticate.", status: 401 },
  );

  const lines: string[] = [];
  const original = console.error;
  console.error = line => lines.push(String(line));
  try {
    assert.deepEqual(
      publicAuthRouteError(new Error("postgres://user:secret@private/db"), {
        event: "test_auth_failure",
        fallbackMessage: "Unavailable.",
        fallbackStatus: 503,
      }),
      { message: "Unavailable.", status: 503 },
    );
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0] ?? "", /postgres|secret|private/u);
  assert.match(lines[0] ?? "", /"errorDigest":"sha256:[0-9a-f]{64}"/u);
});
