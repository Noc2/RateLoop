import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { __workspaceElicitationTestUtils } from "~~/lib/mcp/workspaceElicitation";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function approvalResult() {
  return {
    schemaVersion: "rateloop.human-review-route.v1",
    action: "owner_approval_required",
    opportunityId: "opportunity_fixture_01",
    authority: "prepare_for_approval",
    lane: "private_unpaid",
    approval: {
      approvalId: "hrap_fixture_01",
      revision: 2,
      expiresAt: "2026-07-17T13:00:00.000Z",
      maximumConsentAtomic: "5250000",
      preparedRequest: {
        question: {
          criterion: "Which response is safer?",
        },
        audience: {
          kind: "private_invited",
          contentBoundary: "private_workspace",
          requiredExpertiseKeys: ["software_security"],
        },
        panel: { size: 5 },
        timing: { responseWindowSeconds: 3600 },
        requestProfile: { hash: `sha256:${"a".repeat(64)}` },
        contentCommitments: {
          source: `sha256:${"b".repeat(64)}`,
          suggestion: `sha256:${"c".repeat(64)}`,
        },
      },
      economics: {
        compensationMode: "usdc",
        bountyPerSeatAtomic: "1000000",
      },
      feedbackBonusEconomics: { enabled: true, poolAtomic: "1000000" },
    },
  } as never;
}

test("builds capability-gated, content-free stable MCP form elicitation", () => {
  assert.equal(__workspaceElicitationTestUtils.elicitationMode("2025-03-26", { elicitation: {} }), "none");
  assert.equal(__workspaceElicitationTestUtils.elicitationMode("2025-06-18", {}), "none");
  assert.equal(__workspaceElicitationTestUtils.elicitationMode("2025-06-18", { elicitation: {} }), "form");
  assert.equal(__workspaceElicitationTestUtils.elicitationMode("2025-11-25", { elicitation: { form: {} } }), "form");
  assert.equal(__workspaceElicitationTestUtils.elicitationMode("2025-11-25", { elicitation: { url: {} } }), "none");
  const request = __workspaceElicitationTestUtils.elicitationRequest({
    id: `mcpel_${"a".repeat(48)}`,
    result: approvalResult(),
  });
  assert.equal(request.method, "elicitation/create");
  assert.deepEqual(request.params.requestedSchema.required, ["approve"]);
  assert.match(request.params.message, /maximum charge: 5250000 atomic USDC/u);
  assert.match(request.params.message, /Question: Which response is safer\?/u);
  assert.match(request.params.message, /material: private_workspace/u);
  assert.match(request.params.message, /required expertise: software_security/u);
  assert.match(request.params.message, /compensation: 1000000 atomic USDC per seat/u);
  assert.match(request.params.message, /optional feedback bonus: 1000000 atomic USDC/u);
  assert.doesNotMatch(JSON.stringify(request), /sourcePayload|suggestionPayload|reviewer/u);
});

test("renders private unpaid approval without a fictional USDC bounty", () => {
  const result = approvalResult() as unknown as {
    approval: { economics: { compensationMode: string; bountyPerSeatAtomic: string } };
  };
  result.approval.economics = {
    compensationMode: "unpaid",
    bountyPerSeatAtomic: "0",
  };
  const request = __workspaceElicitationTestUtils.elicitationRequest({
    id: `mcpel_${"d".repeat(48)}`,
    result: result as never,
  });
  assert.match(request.params.message, /compensation: unpaid/u);
  assert.doesNotMatch(request.params.message, /0 atomic USDC per seat/u);
  assert.match(request.params.message, /optional feedback bonus: 1000000 atomic USDC/u);
});

test("normalizes response replays and distinguishes reject, decline, and cancel", () => {
  const id = `mcpel_${"b".repeat(48)}`;
  const accepted = __workspaceElicitationTestUtils.responseDecision({
    result: { content: { approve: true }, action: "accept" },
    id,
    jsonrpc: "2.0",
  });
  const reordered = __workspaceElicitationTestUtils.responseDecision({
    jsonrpc: "2.0",
    id,
    result: { action: "accept", content: { approve: true } },
  });
  assert.equal(accepted.action, "approve");
  assert.equal(accepted.canonical, reordered.canonical);
  assert.equal(
    __workspaceElicitationTestUtils.responseDecision({
      jsonrpc: "2.0",
      id,
      result: { action: "accept", content: { approve: false } },
    }).action,
    "reject",
  );
  assert.equal(
    __workspaceElicitationTestUtils.responseDecision({
      jsonrpc: "2.0",
      id,
      result: { action: "decline" },
    }).action,
    "decline",
  );
  assert.throws(
    () =>
      __workspaceElicitationTestUtils.responseDecision({
        jsonrpc: "2.0",
        id,
        result: { action: "accept", content: { approve: true, secret: "no" } },
      }),
    /invalid/u,
  );
});

test("migration and route bind durable session delivery and response correlation", async () => {
  const [migration, preclaimMigration, route, protocol, approvals, elicitation] = await Promise.all([
    readFile(`${repoRoot}/packages/nextjs/drizzle/0091_mcp_elicitation_sessions.sql`, "utf8"),
    readFile(`${repoRoot}/packages/nextjs/drizzle/0102_mcp_preclaim_sessions.sql`, "utf8"),
    readFile(`${repoRoot}/packages/nextjs/app/api/agent/v1/mcp/route.ts`, "utf8"),
    readFile(`${repoRoot}/packages/nextjs/lib/mcp/workspaceProtocol.ts`, "utf8"),
    readFile(`${repoRoot}/packages/nextjs/lib/tokenless/humanReviewApprovals.ts`, "utf8"),
    readFile(`${repoRoot}/packages/nextjs/lib/mcp/workspaceElicitation.ts`, "utf8"),
  ]);
  assert.match(migration, /tokenless_mcp_sessions_integration_binding_fk/u);
  assert.match(migration, /tokenless_mcp_elicitation_requests_approval_binding_fk/u);
  assert.match(migration, /tokenless_mcp_elicitation_requests_session_binding_fk/u);
  assert.match(migration, /state_coherence_check/u);
  assert.match(migration, /protocol_version/u);
  assert.match(migration, /elicitation_mode/u);
  assert.match(migration, /delivery_lease_expires_at/u);
  assert.match(migration, /last_event_id/u);
  assert.match(migration, /processing_lease_id/u);
  assert.match(migration, /processing_response_json/u);
  assert.match(migration, /response_json.*responded_at/su);
  assert.match(preclaimMigration, /ALTER COLUMN "workspace_id" DROP NOT NULL/u);
  assert.match(preclaimMigration, /ALTER COLUMN "integration_id" DROP NOT NULL/u);
  assert.match(preclaimMigration, /tokenless_mcp_sessions_binding_state_check/u);
  assert.match(preclaimMigration, /workspace_id" IS NULL AND "integration_id" IS NULL/u);
  assert.match(preclaimMigration, /workspace_id" IS NOT NULL AND "integration_id" IS NOT NULL/u);
  assert.match(preclaimMigration, /DROP CONSTRAINT "tokenless_mcp_sessions_elicitation_mode_check"/u);
  assert.match(preclaimMigration, /'2025-06-18','2025-11-25'/u);
  assert.match(route, /MCP-Session-Id/u);
  assert.match(route, /text\/event-stream/u);
  assert.match(route, /deliverWorkspaceMcpElicitation/u);
  assert.match(route, /last-event-id/u);
  assert.match(route, /isSuccessfulWorkspaceMcpInitializeResponse/u);
  assert.match(route, /MCP-Protocol-Version, MCP-Session-Id/u);
  assert.match(route, /consumeMcpRateLimit/u);
  assert.match(protocol, /handleWorkspaceMcpElicitationResponse/u);
  assert.match(protocol, /enqueueOwnerApprovalElicitation/u);
  assert.match(approvals, /m\.role IN \('owner','admin'\)/u);
  assert.match(elicitation, /accountAddress: owner\.subjectPrincipalId/u);
  assert.match(elicitation, /decision\.action === "approve" \|\| decision\.action === "reject"/u);
  assert.match(elicitation, /ORDER BY created_at ASC LIMIT 1 FOR UPDATE/u);
  assert.doesNotMatch(elicitation, /MAX_DELIVERIES/u);
});

test("stores only a hash of the MCP session bearer", () => {
  const raw = `mcps_${"A".repeat(43)}`;
  const hashed = __workspaceElicitationTestUtils.sessionHash(raw);
  assert.match(hashed, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(hashed.includes(raw), false);
  assert.throws(() => __workspaceElicitationTestUtils.sessionHash("mcps_short"), /invalid/u);
});

test("validates negotiated protocol and resumability cursors", () => {
  assert.equal(__workspaceElicitationTestUtils.protocolVersion("2025-06-18"), "2025-06-18");
  assert.throws(() => __workspaceElicitationTestUtils.protocolVersion("2024-01-01"), /protocol version is invalid/u);
  assert.equal(__workspaceElicitationTestUtils.lastEventId(null), null);
  assert.equal(__workspaceElicitationTestUtils.lastEventId("mcpel_fixture:1"), "mcpel_fixture:1");
  assert.throws(() => __workspaceElicitationTestUtils.lastEventId("bad\nid"), /Last-Event-ID is invalid/u);
});

test("returns a session ID only for a successful initialize result", () => {
  assert.equal(
    __workspaceElicitationTestUtils.isSuccessfulWorkspaceMcpInitializeResponse({
      error: { code: -32602, message: "invalid" },
      id: 1,
      jsonrpc: "2.0",
    }),
    false,
  );
  assert.equal(
    __workspaceElicitationTestUtils.isSuccessfulWorkspaceMcpInitializeResponse({
      id: 1,
      jsonrpc: "2.0",
      result: { protocolVersion: "2025-06-18" },
    }),
    true,
  );
});

test("fences response retries to the original canonical decision", () => {
  const now = new Date("2026-07-17T08:30:00.000Z");
  assert.doesNotThrow(() =>
    __workspaceElicitationTestUtils.authorizeProcessingLease({
      row: { state: "delivered" },
      canonicalResponse: "approve",
      now,
    }),
  );
  assert.doesNotThrow(() =>
    __workspaceElicitationTestUtils.authorizeProcessingLease({
      row: {
        state: "processing",
        processing_response_json: "approve",
        processing_started_at: "2026-07-17T08:28:00.000Z",
      },
      canonicalResponse: "approve",
      now,
    }),
  );
  assert.throws(
    () =>
      __workspaceElicitationTestUtils.authorizeProcessingLease({
        row: {
          state: "processing",
          processing_response_json: "approve",
          processing_started_at: "2026-07-17T08:29:30.000Z",
        },
        canonicalResponse: "approve",
        now,
      }),
    /already processing/u,
  );
  assert.throws(
    () =>
      __workspaceElicitationTestUtils.authorizeProcessingLease({
        row: {
          state: "processing",
          processing_response_json: "approve",
          processing_started_at: "2026-07-17T08:28:00.000Z",
        },
        canonicalResponse: "reject",
        now,
      }),
    /Conflicting/u,
  );
});
