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

test("an unauthenticated exchange is refused without writing to the audit chain", async () => {
  // Every audit append takes FOR UPDATE on the single head row for
  // ("system", "authentication"). Auditing a request that carried no credentials
  // let an anonymous caller serialise every one of those on one lock and grow an
  // unbounded table, for a signal no other route in this application records.
  const source = exchangeSession.toString();
  const refusalIndex = source.indexOf("unauthenticatedRefusal");
  const auditIndex = source.indexOf("appendSecurityAuditEventOrReportFailure");
  assert.ok(refusalIndex >= 0, "the pre-authentication refusal should be reachable from the handler");
  assert.ok(auditIndex > refusalIndex, "the refusal must return before anything is appended");

  // A cross-origin request is the cheapest way in, and needs no database at all.
  const denied = await exchangeSession(
    new Request("https://rateloop-tokenless.vercel.app/api/auth/exchange", {
      headers: { origin: "https://attacker.example" },
      method: "POST",
    }) as never,
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Cache-Control"), "no-store");
  assert.match((await denied.json()).error, /Cross-origin authentication request denied/u);
});
