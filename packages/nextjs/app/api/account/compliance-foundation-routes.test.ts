import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, before } from "node:test";
import { benchmarkResearchApplication } from "~~/app/api/_support/complianceRoutes";
import { createBenchmarkResearchAccessPost } from "~~/app/api/account/benchmark-research/access/route";
import { createBenchmarkExportPost } from "~~/app/api/account/workspaces/[workspaceId]/assurance/projects/[projectId]/benchmark-research/exports/route";
import { createBenchmarkResearchGrantPost } from "~~/app/api/account/workspaces/[workspaceId]/assurance/projects/[projectId]/benchmark-research/grants/route";
import { createComplianceSharePost } from "~~/app/api/account/workspaces/[workspaceId]/assurance/projects/[projectId]/compliance-shares/route";
import { createDsaPart8FileGet } from "~~/app/api/account/workspaces/[workspaceId]/compliance/dsa/part8/reports/[reportId]/versions/[reportVersion]/files/[fileKind]/route";
import {
  createPart8ReportPost,
  POST as productionCreateReport,
} from "~~/app/api/account/workspaces/[workspaceId]/compliance/dsa/part8/reports/route";
import { createComplianceShareAccessPost } from "~~/app/api/compliance-shares/[shareId]/access/route";
import { createPublishedDsaPart8FileGet } from "~~/app/rate/dsa/part8/reports/[reportId]/versions/[reportVersion]/section-1-6.csv/route";
import { requireBrowserSession } from "~~/lib/auth/request";
import type { consumeEvidenceShareRateLimit } from "~~/lib/mcp/rateLimit";
import type { BenchmarkResearchPersistence } from "~~/lib/tokenless/benchmarkResearchPersistence";
import type {
  createDsaPart8ReportVersion,
  downloadDsaPart8ReportVersion,
  downloadPublishedDsaPart8ReportVersion,
} from "~~/lib/tokenless/dsaPart8ReportVersions";
import type {
  accessProjectWindowComplianceShare,
  issueProjectWindowComplianceShare,
} from "~~/lib/tokenless/projectWindowComplianceShares";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ORIGIN = "https://tokenless.example.test";
const NO_STORE = "private, no-store, max-age=0";
const previousAppUrl = process.env.APP_URL;
type CreateReportInput = Parameters<typeof createDsaPart8ReportVersion>[0];
type IssueShareInput = Parameters<typeof issueProjectWindowComplianceShare>[0];

before(() => {
  process.env.APP_URL = ORIGIN;
});

after(() => {
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

function request(path: string, body: unknown) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

const signedIn = (async () => ({ principalId: `rlp_${"a".repeat(40)}` })) as unknown as typeof requireBrowserSession;

test("Part 8 report creation requires a browser session and injects the path workspace into the production input", async () => {
  const unauthenticated = await productionCreateReport(
    request("/api/account/workspaces/workspace_route/compliance/dsa/part8/reports", { build: {} }),
    { params: Promise.resolve({ workspaceId: "workspace_route" }) },
  );
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("cache-control"), NO_STORE);

  const received: { value?: CreateReportInput } = {};
  const handler = createPart8ReportPost({
    requireSession: signedIn,
    createReport: (async (input: CreateReportInput) => {
      received.value = input;
      return { report: { reportId: "dsa8r_route" }, cells: [], files: [] };
    }) as unknown as typeof createDsaPart8ReportVersion,
  });
  const response = await handler(
    request("/api/account/workspaces/workspace_route/compliance/dsa/part8/reports", {
      build: { workspaceId: "attacker_workspace", methodEvidence: null },
    }),
    { params: Promise.resolve({ workspaceId: "workspace_route" }) },
  );
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(received.value?.accountAddress, `rlp_${"a".repeat(40)}`);
  assert.equal(received.value?.build.workspaceId, "workspace_route");
  assert.equal(response.headers.get("cache-control"), NO_STORE);
});

test("Part 8 report creation rejects non-canonical method-evidence base64 before any write", async () => {
  let called = false;
  const handler = createPart8ReportPost({
    requireSession: signedIn,
    createReport: (async () => {
      called = true;
      throw new Error("must not run");
    }) as typeof createDsaPart8ReportVersion,
  });
  const response = await handler(
    request("/api/account/workspaces/workspace_route/compliance/dsa/part8/reports", {
      build: { methodEvidence: { evidenceBytesBase64: "not base64!" } },
    }),
    { params: Promise.resolve({ workspaceId: "workspace_route" }) },
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("project-window share creation passes only authenticated path scope and canonical dates to the service", async () => {
  const received: { value?: IssueShareInput } = {};
  const handler = createComplianceSharePost({
    requireSession: signedIn,
    issueShare: (async (input: IssueShareInput) => {
      received.value = input;
      return { grant: { shareId: "pwcs_route" }, bearerSecret: "secret_once" };
    }) as unknown as typeof issueProjectWindowComplianceShare,
  });
  const response = await handler(
    request("/api/account/workspaces/workspace_route/assurance/projects/project_route/compliance-shares", {
      evidenceWindowStart: "2026-07-01T00:00:00.000Z",
      evidenceWindowEnd: "2026-08-01T00:00:00.000Z",
      evidencePacketIds: ["packet_route"],
      reportVersions: [{ reportId: "report_route", reportVersion: 1 }],
      expiresAt: "2026-08-02T00:00:00.000Z",
      idempotencyKey: "share-issuance-route-0001",
    }),
    { params: Promise.resolve({ workspaceId: "workspace_route", projectId: "project_route" }) },
  );
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(received.value?.workspaceId, "workspace_route");
  assert.equal(received.value?.projectId, "project_route");
  assert.equal(received.value?.accountAddress, `rlp_${"a".repeat(40)}`);
  assert.equal(received.value?.evidenceWindowStart.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(received.value?.idempotencyKey, "share-issuance-route-0001");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("benchmark export approval hides a path/body tenant mismatch and performs no approval", async () => {
  let called = false;
  const handler = createBenchmarkExportPost({
    requireSession: signedIn,
    approveExport: (async (input: Parameters<BenchmarkResearchPersistence["approveExport"]>[0]) => {
      called = true;
      return input.export;
    }) as unknown as BenchmarkResearchPersistence["approveExport"],
  });
  const response = await handler(
    request("/api/account/workspaces/workspace_route/assurance/projects/project_route/benchmark-research/exports", {
      epochId: "epoch_route",
      labelSetId: "labels_route",
      export: { workspaceId: "other_workspace", projectId: "project_route" },
    }),
    { params: Promise.resolve({ workspaceId: "workspace_route", projectId: "project_route" }) },
  );
  assert.equal(response.status, 404);
  assert.equal(called, false);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
});

test("issuance retries return authenticated metadata without minting a second research token", async () => {
  let calls = 0;
  const persistedGrant = { grantId: "brg_route_recovery_0001" };
  const handler = createBenchmarkResearchGrantPost({
    requireSession: signedIn,
    application: (() => ({
      currentTokenLookupKeyId: "research-route-v1",
      currentRecipientBindingKeyId: "recipient-route-v1",
      persistence: {
        issueGrant: async (input: Parameters<BenchmarkResearchPersistence["issueGrant"]>[0]) => {
          calls += 1;
          assert.equal(input.idempotencyKey, "grant-issuance-route-0001");
          return {
            grant: persistedGrant,
            token: null,
            tokenLookupKeyId: "research-original-v1",
            idempotent: true,
            recoveryRequired: true,
          };
        },
      },
    })) as unknown as typeof benchmarkResearchApplication,
  });
  const response = await handler(
    request("/api/account/workspaces/workspace_route/assurance/projects/project_route/benchmark-research/grants", {
      recipientPrincipalId: `rlp_${"b".repeat(40)}`,
      exportId: "export_route",
      purpose: "methodology_validation",
      durationMs: 60_000,
      idempotencyKey: "grant-issuance-route-0001",
    }),
    { params: Promise.resolve({ workspaceId: "workspace_route", projectId: "project_route" }) },
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), {
    grant: persistedGrant,
    token: null,
    tokenLookupKeyId: "research-original-v1",
    idempotent: true,
    recoveryRequired: true,
  });
  assert.equal(response.headers.get("cache-control"), NO_STORE);
});

test("confidential Part 8 download is attachment-only, exact-byte, and private no-store", async () => {
  const bytes = new TextEncoder().encode('{"confidential":true}');
  const handler = createDsaPart8FileGet({
    requireSession: signedIn,
    downloadFile: (async () => ({
      reportId: "report_route",
      reportVersion: 3,
      reportDigest: `sha256:${"1".repeat(64)}`,
      fileKind: "confidential_evidence_json",
      mediaType: "application/json",
      fileDigest: `sha256:${"2".repeat(64)}`,
      bytes,
    })) as typeof downloadDsaPart8ReportVersion,
  });
  const response = await handler(new NextRequest(`${ORIGIN}/private-file`), {
    params: Promise.resolve({
      workspaceId: "workspace_route",
      reportId: "report_route",
      reportVersion: "3",
      fileKind: "confidential_evidence_json",
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/u);
  assert.equal(response.headers.get("x-content-sha256"), `sha256:${"2".repeat(64)}`);
});

test("published Part 8 CSV returns the exact verified bytes and digest metadata", async () => {
  const bytes = new TextEncoder().encode("Applicability,Service\nYes,RateLoop\n");
  const handler = createPublishedDsaPart8FileGet({
    downloadFile: (async () => ({
      reportId: "report_route",
      reportVersion: 3,
      reportDigest: `sha256:${"3".repeat(64)}`,
      publicationDigest: `sha256:${"4".repeat(64)}`,
      mediaType: "text/csv; charset=utf-8",
      fileDigest: `sha256:${"5".repeat(64)}`,
      bytes,
    })) as typeof downloadPublishedDsaPart8ReportVersion,
  });
  const response = await handler(new Request(`${ORIGIN}/rate/dsa/report.csv`), {
    params: Promise.resolve({ reportId: "report_route", reportVersion: "3" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("x-content-sha256"), `sha256:${"5".repeat(64)}`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("compliance-share bearer access returns success and uniformly hides invalid or revoked capabilities", async () => {
  const secret = "s".repeat(43);
  const accessRequest = () =>
    new NextRequest(`${ORIGIN}/api/compliance-shares/pwcs_route/access`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "route-access-0001",
        artifact: { artifactKind: "part8_report_version", reportId: "report_route", reportVersion: 3 },
      }),
    });
  const allow = (async () => ({
    allowed: true,
    limit: 10,
    remaining: 9,
    retryAfterSeconds: 0,
  })) as unknown as typeof consumeEvidenceShareRateLimit;
  const notFound = new TokenlessServiceError(
    "Project-window compliance share not found.",
    404,
    "project_window_compliance_share_not_found",
  );
  for (const state of ["invalid", "revoked"] as const) {
    const handler = createComplianceShareAccessPost({
      consumeRateLimit: allow,
      accessShare: (async () => {
        throw notFound;
      }) as typeof accessProjectWindowComplianceShare,
    });
    const response = await handler(accessRequest(), { params: Promise.resolve({ shareId: `pwcs_${state}` }) });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      code: "project_window_compliance_share_not_found",
      message: "Project-window compliance share not found.",
      retryable: false,
    });
  }

  const payload = new TextEncoder().encode('{"artifact":"bounded"}');
  let receivedSecret = "";
  const success = createComplianceShareAccessPost({
    consumeRateLimit: allow,
    accessShare: (async input => {
      receivedSecret = input.bearerSecret;
      return {
        accessId: "pwca_route_access",
        replayed: false,
        responseHash: `sha256:${"8".repeat(64)}`,
        contentType: "application/json; charset=utf-8",
        bytes: payload,
      };
    }) as typeof accessProjectWindowComplianceShare,
  });
  const response = await success(accessRequest(), { params: Promise.resolve({ shareId: "pwcs_valid" }) });
  assert.equal(response.status, 200);
  assert.equal(receivedSecret, secret);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), payload);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
  assert.equal(response.headers.get("x-rateloop-access-id"), "pwca_route_access");
  assert.equal(response.headers.get("x-content-sha256"), `sha256:${"8".repeat(64)}`);
});

test("benchmark research access returns the exact committed bytes and preserves replay audit metadata", async () => {
  const token = "research_" + "t".repeat(43);
  const bytes = new TextEncoder().encode('{"schemaVersion":"rateloop.public-research-view.v1"}');
  let invocation = 0;
  const handler = createBenchmarkResearchAccessPost({
    requireSession: signedIn,
    readByToken: (async input => {
      invocation += 1;
      assert.equal(input.token, token);
      assert.equal(input.tokenLookupKeyId, "research-route-v1");
      return {
        schemaVersion: "rateloop.benchmark-research-committed-read.v1",
        accessId: input.accessId,
        idempotencyKey: input.idempotencyKey,
        accessedAt: "2026-08-01T00:00:00.000Z",
        replayed: invocation > 1,
        contentType: "application/json; charset=utf-8",
        bytes,
        commitReceipt: {
          status: "committed",
          transactionId: "brtx_route",
          committedAt: "2026-08-01T00:00:01.000Z",
          auditEventId: "audit_route",
          auditEventDigest: `sha256:${"6".repeat(64)}`,
          chainHeadDigest: `sha256:${"7".repeat(64)}`,
        },
      };
    }) as BenchmarkResearchPersistence["readByToken"],
  });
  const researchRequest = () =>
    new NextRequest(`${ORIGIN}/api/account/benchmark-research/access`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-rateloop-benchmark-key-id": "research-route-v1",
      },
      body: JSON.stringify({ idempotencyKey: "research-route-access-0001", page: { offset: 0, limit: 10 } }),
    });
  const first = await handler(researchRequest());
  const replay = await handler(researchRequest());
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), bytes);
  assert.deepEqual(new Uint8Array(await replay.arrayBuffer()), bytes);
  assert.equal(first.headers.get("x-rateloop-idempotent-replay"), "false");
  assert.equal(replay.headers.get("x-rateloop-idempotent-replay"), "true");
  assert.equal(first.headers.get("x-rateloop-audit-event-digest"), `sha256:${"6".repeat(64)}`);
  assert.equal(first.headers.get("x-rateloop-chain-head-digest"), `sha256:${"7".repeat(64)}`);
  assert.equal(first.headers.get("x-content-sha256"), `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  assert.equal(first.headers.get("cache-control"), NO_STORE);
});

test("benchmark research access rejects nested pagination fields before capability lookup", async () => {
  let called = false;
  const handler = createBenchmarkResearchAccessPost({
    requireSession: signedIn,
    readByToken: (async () => {
      called = true;
      throw new Error("must not run");
    }) as BenchmarkResearchPersistence["readByToken"],
  });
  const response = await handler(
    new NextRequest(`${ORIGIN}/api/account/benchmark-research/access`, {
      method: "POST",
      headers: {
        authorization: `Bearer research_${"t".repeat(43)}`,
        "content-type": "application/json",
        "x-rateloop-benchmark-key-id": "research-route-v1",
      },
      body: JSON.stringify({
        idempotencyKey: "research-route-access-0002",
        page: { offset: 0, limit: 10, privateCursor: "must-not-pass" },
      }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
});

test("published Part 8 errors are never publicly cacheable", async () => {
  const handler = createPublishedDsaPart8FileGet({
    downloadFile: (async () => {
      throw new TokenlessServiceError("Report not found.", 404, "dsa_part8_report_not_found");
    }) as typeof downloadPublishedDsaPart8ReportVersion,
  });
  const response = await handler(new Request(`${ORIGIN}/rate/dsa/missing.csv`), {
    params: Promise.resolve({ reportId: "missing_report", reportVersion: "1" }),
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
});
