import { canonicalizeRfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import type { BenchmarkResearchApprovedExport } from "~~/lib/tokenless/benchmarkResearchGrants";
import {
  __benchmarkResearchPersistenceTestUtils,
  benchmarkResearchExportApprovalAuditMetadata,
  createBenchmarkResearchPersistence,
  deriveBenchmarkResearchTokenLookupDigest,
} from "~~/lib/tokenless/benchmarkResearchPersistence";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryRecord = { text: string; values?: unknown[] };

function fakePool(handler: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) {
  const queries: QueryRecord[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return handler(text, values);
    },
    release() {},
  } as unknown as PoolClient;
  return {
    pool: {
      async connect() {
        return client;
      },
    } as unknown as Pick<Pool, "connect">,
    queries,
  };
}

const exportWitness = {
  schemaVersion: "rateloop.approved-public-safe-reference-export.v1",
  exportId: "export_contractual_research",
  workspaceId: "workspace_contractual_research",
  projectId: "project_contractual_research",
  benchmarkId: "benchmark_contractual_research",
  activationReference: "activation_contractual_research",
  referenceProvenance: {
    schemaVersion: "rateloop.benchmark-research-reference-provenance.v1",
    derivationSource: "independent_reference_panel",
    labelSetId: `rsls_${"5".repeat(40)}`,
    labelSetHash: `sha256:${"6".repeat(64)}`,
    bridgeHash: `sha256:${"7".repeat(64)}`,
    reportingMode: "independent_reference_panel_research_only",
    populationClaim: false,
    operationalRollupEligible: false,
    adaptiveReuseAllowed: false,
  },
  approval: {
    approvalId: "approval_contractual_research",
    approvedBy: "rlp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    approvedAt: "2026-08-01T10:00:00.000Z",
    auditBinding: {
      eventId: `audit_${"1".repeat(32)}`,
      eventDigest: `sha256:${"2".repeat(64)}`,
      artifactDigest: `sha256:${"3".repeat(64)}`,
    },
    attestationBinding: {
      jobId: `aat_${"4".repeat(40)}`,
      kind: "audit_export_head",
      artifactDigest: `sha256:${"2".repeat(64)}`,
    },
  },
} as unknown as BenchmarkResearchApprovedExport;

test("token lookup is deterministic HMAC evidence and never stores the bearer token", () => {
  const key = { keyId: "lookup-v1", secret: new Uint8Array(32).fill(7) };
  const first = deriveBenchmarkResearchTokenLookupDigest({ token: "a".repeat(43), key });
  const replay = deriveBenchmarkResearchTokenLookupDigest({ token: "a".repeat(43), key });
  const different = deriveBenchmarkResearchTokenLookupDigest({ token: "b".repeat(43), key });
  assert.equal(first, replay);
  assert.notEqual(first, different);
  assert.match(first, /^hmac-sha256:[0-9a-f]{64}$/u);
  assert.doesNotMatch(first, /aaa/u);
});

test("agreement acceptance rolls back unless a manager-created exact offer authorizes the recipient", async () => {
  const database = fakePool(async text => {
    if (text.startsWith("BEGIN") || text === "ROLLBACK") return { rows: [] };
    if (text.includes("tokenless_benchmark_research_agreement_offers")) return { rows: [] };
    throw new Error(`Unexpected query: ${text}`);
  });
  const persistence = createBenchmarkResearchPersistence({ pool: database.pool });
  await assert.rejects(
    persistence.acceptAgreement({
      authenticatedRecipientPrincipalId: "rlp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceId: "workspace_contractual_research",
      projectId: "project_contractual_research",
      benchmarkId: "benchmark_contractual_research",
      agreementId: "agreement_contractual_research",
      agreementVersion: 1,
      purpose: "methodology_validation",
    }),
    /project not found/iu,
  );
  assert.ok(database.queries.some(query => query.text.includes("JOIN tokenless_benchmark_research_agreement_offers")));
  assert.ok(database.queries.some(query => query.text === "ROLLBACK"));
  assert.ok(
    !database.queries.some(query =>
      query.text.includes("INSERT INTO tokenless_benchmark_research_agreement_acceptances"),
    ),
  );
});

test("an unrelated audit event cannot witness export approval", async () => {
  const metadata = benchmarkResearchExportApprovalAuditMetadata(exportWitness);
  const database = fakePool(async text => {
    assert.match(text, /tokenless_assurance_attestation_jobs/u);
    return {
      rows: [
        {
          actor_kind: "principal",
          actor_reference: exportWitness.approval.approvedBy,
          assurance_method: "authenticated_workspace_manager",
          action: "unrelated_workspace_action",
          target_kind: "benchmark_research_approved_export",
          target_id: exportWitness.exportId,
          purpose: "contractual_public_safe_benchmark_research",
          reason: "immutable_public_safe_export_approval",
          request_correlation: exportWitness.approval.approvalId,
          result: "success",
          metadata_json: JSON.stringify(metadata),
          occurred_at: exportWitness.approval.approvedAt,
          artifact_schema_version: "rateloop-audit-v1",
          boundary_at: exportWitness.approval.approvedAt,
          statement_json: "{}",
        },
      ],
    };
  });
  await assert.rejects(
    __benchmarkResearchPersistenceTestUtils.requireExactApprovedExportWitness(
      (await database.pool.connect()) as PoolClient,
      exportWitness,
    ),
    /does not bind the exact approval/iu,
  );
});

test("grant issuance replay returns no second bearer token and request mismatch rolls back", async () => {
  const manager = `rlp_${"a".repeat(40)}`;
  const request = {
    authenticatedManagerPrincipalId: manager,
    workspaceId: "workspace_replay",
    projectId: "project_replay",
    recipientPrincipalId: `rlp_${"b".repeat(40)}`,
    exportId: "export_replay",
    purpose: "methodology_validation" as const,
    durationMs: 60_000,
    idempotencyKey: "grant-issuance-replay-0001",
    tokenLookupKeyId: "current-token-v2",
    recipientBindingKeyId: "current-recipient-v2",
  };
  const binding = __benchmarkResearchPersistenceTestUtils.deriveCapabilityIssuanceIdempotency({
    capabilityKind: "benchmark_research_grant",
    actorPrincipalId: manager,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    idempotencyKey: request.idempotencyKey,
    request: {
      recipientPrincipalId: request.recipientPrincipalId,
      exportId: request.exportId,
      purpose: request.purpose,
      durationMs: request.durationMs,
    },
  });
  const grantJson = canonicalizeRfc8785({ grantId: "brg_replayed_metadata" });
  const grantDigest = `sha256:${createHash("sha256").update(grantJson).digest("hex")}`;
  const database = fakePool(async text => {
    if (text.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: true }] };
    if (text.startsWith("BEGIN") || text === "COMMIT") return { rows: [] };
    if (text.includes("FROM tokenless_workspaces w")) {
      return {
        rows: [{ workspace_status: "active", project_status: "active", role: "owner", principal_status: "active" }],
      };
    }
    if (text.includes("tokenless_benchmark_research_grant_issuances i")) {
      return {
        rows: [
          {
            request_binding_hash: binding.requestBindingHash,
            grant_json: grantJson,
            event_digest: grantDigest,
            token_lookup_key_id: "original-token-v1",
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  const persistence = createBenchmarkResearchPersistence({ pool: database.pool });
  const replay = await persistence.issueGrant(request);
  assert.deepEqual(replay, {
    grant: { grantId: "brg_replayed_metadata", eventDigest: grantDigest },
    token: null,
    tokenLookupKeyId: "original-token-v1",
    idempotent: true,
    recoveryRequired: true,
  });
  assert.equal(
    database.queries.some(query => /INSERT INTO tokenless_benchmark_research_grants/u.test(query.text)),
    false,
  );
  assert.equal(
    database.queries.some(query => /INSERT INTO tokenless_benchmark_research_grant_issuances/u.test(query.text)),
    false,
  );
  assert.equal(
    database.queries.some(query => query.text === "COMMIT"),
    true,
  );
  assert.ok(
    database.queries.findIndex(query => query.text.includes("pg_try_advisory_xact_lock")) <
      database.queries.findIndex(query => query.text.includes("FROM tokenless_workspaces w")),
  );

  const conflictDatabase = fakePool(async text => {
    if (text.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: true }] };
    if (text.startsWith("BEGIN") || text === "ROLLBACK") {
      return { rows: [] };
    }
    if (text.includes("FROM tokenless_workspaces w")) {
      return {
        rows: [{ workspace_status: "active", project_status: "active", role: "owner", principal_status: "active" }],
      };
    }
    if (text.includes("tokenless_benchmark_research_grant_issuances i")) {
      return {
        rows: [
          {
            request_binding_hash: `sha256:${"0".repeat(64)}`,
            grant_json: grantJson,
            event_digest: grantDigest,
            token_lookup_key_id: "original-token-v1",
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  await assert.rejects(
    createBenchmarkResearchPersistence({ pool: conflictDatabase.pool }).issueGrant(request),
    (error: TokenlessServiceError) =>
      error.status === 409 && error.code === "benchmark_research_grant_issuance_conflict",
  );
  assert.equal(
    conflictDatabase.queries.some(query => query.text === "ROLLBACK"),
    true,
  );
  assert.equal(
    conflictDatabase.queries.some(query => query.text.startsWith("INSERT")),
    false,
  );
});
