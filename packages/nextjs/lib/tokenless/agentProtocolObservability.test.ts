import assert from "node:assert/strict";
import test from "node:test";
import { reportAgentProtocolFailure } from "~~/lib/tokenless/agentProtocolObservability";

test("agent protocol diagnostics redact unexpected failures and normalize unsafe codes", () => {
  const reported: unknown[] = [];
  const failure = reportAgentProtocolFailure(
    {
      endpoint: "workspace_mcp",
      method: "GET",
      status: 500,
      errorCode: "secret=should-not-be-a-code",
      error: new Error("postgres://user:password@private.example/db"),
    },
    { report: value => reported.push(value) },
  );

  assert.deepEqual(reported, [failure]);
  assert.equal(failure.errorCode, "invalid_error_code");
  assert.match(failure.errorDigest ?? "", /^sha256:[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(failure), /password|private\.example|should-not-be-a-code/u);
});
