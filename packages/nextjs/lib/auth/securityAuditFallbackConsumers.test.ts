import assert from "node:assert/strict";
import { test } from "node:test";
import { __enterpriseAuthRouteTestUtils } from "~~/app/api/auth/better/[...all]/route";
import { POST as exchangeSession } from "~~/app/api/auth/exchange/route";
import { appendSecurityAuditEventOrReportFailure } from "~~/lib/privacy/audit";

const FAILED_AUTH_EVENT = {
  action: "auth.test_failed",
  actorKind: "system" as const,
  actorReference: "anonymous",
  assuranceMethod: "test",
  purpose: "account_access",
  reason: "test_failure",
  result: "failure" as const,
  scopeId: "authentication",
  scopeKind: "system" as const,
  targetId: "test",
  targetKind: "authentication",
};

test("every failed-auth route uses the shared non-silent security-audit fallback", () => {
  assert.match(exchangeSession.toString(), /appendSecurityAuditEventOrReportFailure/u);
  assert.match(__enterpriseAuthRouteTestUtils.handle.toString(), /appendSecurityAuditEventOrReportFailure/u);
});

test("an unavailable audit store emits a secret-free structured failure signal", async () => {
  const failures: unknown[] = [];
  const result = await appendSecurityAuditEventOrReportFailure(FAILED_AUTH_EVENT, {
    append: async () => {
      const error = new Error("database rejected super-secret-provider-response") as Error & {
        code: string;
      };
      error.name = "super secret provider class";
      error.code = "super secret provider code";
      throw error;
    },
    report: failure => failures.push(failure),
  });

  assert.equal(result, null);
  assert.equal(failures.length, 1);
  assert.deepEqual(Object.keys(failures[0] as object).sort(), [
    "action",
    "errorClass",
    "errorCode",
    "errorDigest",
    "event",
    "result",
    "scopeKind",
  ]);
  assert.match(String((failures[0] as { errorDigest: string }).errorDigest), /^sha256:[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(failures[0]), /super[- ]secret/u);
});
