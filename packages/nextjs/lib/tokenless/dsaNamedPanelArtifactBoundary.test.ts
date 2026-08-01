import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { __artifactPrivacyTestUtils } from "~~/lib/tokenless/artifactPrivacy";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const audienceAssignmentsSource = readFileSync(new URL("./audienceAssignments.ts", import.meta.url), "utf8");
const dsaNamedPanelSource = readFileSync(new URL("./dsaNamedReferencePanel.ts", import.meta.url), "utf8");
const artifactPrivacySource = readFileSync(new URL("./artifactPrivacy.ts", import.meta.url), "utf8");
const workspaceArtifactRouteSource = readFileSync(
  new URL(
    "../../app/api/account/workspaces/[workspaceId]/assurance/projects/[projectId]/artifacts/[artifactId]/route.ts",
    import.meta.url,
  ),
  "utf8",
);

afterEach(() => __setDatabaseResourcesForTests(null));

function boundaryDatabase(rowOrRows?: Record<string, unknown> | Record<string, unknown>[]) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const rows = Array.isArray(rowOrRows) ? rowOrRows : rowOrRows ? [rowOrRows] : [];
  __setDatabaseResourcesForTests({
    client: {
      async execute(input: string | { sql: string; args?: unknown[] }) {
        const sql = typeof input === "string" ? input : input.sql;
        const args = typeof input === "string" ? [] : (input.args ?? []);
        calls.push({ sql, args });
        return { rows, rowCount: rows.length };
      },
    },
  } as never);
  return calls;
}

const boundaryInput = {
  accountAddress: "rlp_named_panel_reviewer_0001",
  artifactId: "artifact_candidate",
  projectId: "project_named_panel",
  workspaceId: "workspace_named_panel",
};

test("generic artifact access fails closed for a reviewer bound to a named-panel artifact", async () => {
  const calls = boundaryDatabase({
    accepted_panel_assignment: false,
    accepted_adjudication_lease: false,
  });

  await assert.rejects(
    () => __artifactPrivacyTestUtils.assertDsaNamedPanelArtifactBoundary(boundaryInput),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.status === 404 && error.code === "artifact_not_found",
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /unit\.content_artifact_id=\?/u);
  assert.deepEqual(calls[0]!.args.slice(0, 4), [boundaryInput.accountAddress, "", "", boundaryInput.accountAddress]);
  assert.deepEqual(calls[0]!.args.slice(7), [
    boundaryInput.artifactId,
    boundaryInput.workspaceId,
    boundaryInput.projectId,
    null,
    "",
    "",
  ]);
});

test("only the accepted specialized assignment marker crosses the named-panel artifact boundary", async () => {
  boundaryDatabase({ accepted_panel_assignment: false, accepted_adjudication_lease: false });
  await assert.rejects(
    () =>
      __artifactPrivacyTestUtils.assertDsaNamedPanelArtifactBoundary({
        ...boundaryInput,
        dsaNamedPanelAssignmentId: "assignment_named_panel",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_not_found",
  );

  boundaryDatabase({
    accepted_panel_assignment: true,
    accepted_adjudication_lease: false,
  });
  await __artifactPrivacyTestUtils.assertDsaNamedPanelArtifactBoundary({
    ...boundaryInput,
    dsaNamedPanelAssignmentId: "assignment_named_panel",
  });

  boundaryDatabase();
  await __artifactPrivacyTestUtils.assertDsaNamedPanelArtifactBoundary(boundaryInput);
});

test("adjudicators cross the boundary only with an exact purpose-bound marker", async () => {
  boundaryDatabase({ accepted_panel_assignment: false, accepted_adjudication_lease: false });
  await assert.rejects(
    () =>
      __artifactPrivacyTestUtils.assertDsaNamedPanelArtifactBoundary({
        ...boundaryInput,
        leaseId: "lease_generic",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_not_found",
  );

  boundaryDatabase({ accepted_panel_assignment: false, accepted_adjudication_lease: true });
  await __artifactPrivacyTestUtils.assertDsaNamedPanelArtifactBoundary({
    ...boundaryInput,
    leaseId: "lease_dsa_adjudication",
  });
  assert.match(artifactPrivacySource, /tokenless_dsa_named_panel_adjudication_artifact_leases marker/u);
  assert.match(artifactPrivacySource, /lease\.purpose='dsa_named_panel_adjudication'/u);
  assert.match(
    artifactPrivacySource,
    /NOT EXISTS \(\s*SELECT 1 FROM tokenless_workspace_members member[\s\S]*marker\.adjudicator_principal_id/u,
  );
  assert.match(
    artifactPrivacySource,
    /NOT EXISTS \(\s*SELECT 1 FROM tokenless_project_access_assignments access[\s\S]*access\.expires_at>\?/u,
  );
  assert.match(
    artifactPrivacySource,
    /NOT EXISTS \(\s*SELECT 1 FROM tokenless_dsa_named_panel_reference_definitions definition[\s\S]*definition\.created_by=marker\.adjudicator_principal_id/u,
  );
  assert.match(
    artifactPrivacySource,
    /NOT EXISTS \(\s*SELECT 1 FROM tokenless_dsa_named_panel_adjudications adjudication[\s\S]*adjudication\.unit_id=/u,
  );
});

test("an adjudicated or otherwise ineligible unit cannot append a reusable adjudication read log", async () => {
  const calls = boundaryDatabase();
  await assert.rejects(
    () =>
      __artifactPrivacyTestUtils.appendDsaNamedPanelAdjudicationReadLog({
        ...boundaryInput,
        epochId: "epoch_named_panel",
        leaseId: "lease_dsa_adjudication",
        requestReference: "request_reuse",
        runtime: { commitmentKey: new Uint8Array(32) } as never,
        unitId: "unit_named_panel",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_not_found",
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /INSERT INTO tokenless_assurance_access_logs[\s\S]*SELECT \?, marker\.workspace_id/u);
  assert.match(calls[0]!.sql, /lease\.revoked_at IS NULL AND lease\.expires_at>CURRENT_TIMESTAMP/u);
  assert.match(calls[0]!.sql, /tokenless_dsa_named_panel_adjudications adjudication/u);
  assert.deepEqual(calls[0]!.args.slice(3), [
    boundaryInput.workspaceId,
    boundaryInput.projectId,
    "epoch_named_panel",
    "unit_named_panel",
    boundaryInput.artifactId,
    "lease_dsa_adjudication",
    boundaryInput.accountAddress,
  ]);
});

test("authorization checks every named-panel unit that reuses an artifact", async () => {
  const calls = boundaryDatabase([
    { accepted_panel_assignment: false, accepted_adjudication_lease: false },
    { accepted_panel_assignment: true, accepted_adjudication_lease: false },
  ]);

  await __artifactPrivacyTestUtils.assertDsaNamedPanelArtifactBoundary({
    ...boundaryInput,
    dsaNamedPanelAssignmentId: "assignment_second_unit",
  });

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0]!.sql, /LIMIT 1/u);
});

test("generic lease lifecycle cannot mint or disclose named-panel leases", () => {
  const recoveryStart = audienceAssignmentsSource.indexOf("export async function recoverExpiredAudienceAssignment");
  const leaseStart = audienceAssignmentsSource.indexOf("async function issueAssignmentArtifactLeases");
  const acceptStart = audienceAssignmentsSource.indexOf("export async function acceptAudienceAssignment");
  const recovery = audienceAssignmentsSource.slice(recoveryStart, leaseStart);
  const accept = audienceAssignmentsSource.slice(acceptStart);

  assert.match(recovery, /JOIN tokenless_dsa_named_panel_units unit/u);
  assert.match(recovery, /leases: \[\]/u);
  assert.match(recovery, /dsa_named_panel_recovery_required/u);
  assert.match(accept, /requiresDsaReferencePanelAcceptance\s*\? \[\]/u);
  assert.ok(accept.indexOf("requiresDsaReferencePanelAcceptance") < accept.indexOf("issueAssignmentArtifactLeases"));
  assert.match(audienceAssignmentsSource, /mode: "generic" \| "dsa_named_panel" = "generic"/u);
  assert.match(audienceAssignmentsSource, /row\.dsa_named_panel_accepted !== true/u);
});

test("specialized acceptance owns lease recovery and the workspace route cannot assert its authorization marker", () => {
  assert.match(dsaNamedPanelSource, /await issueDsaNamedPanelArtifactLease/u);
  assert.match(dsaNamedPanelSource, /dsaNamedPanelAssignmentId: input\.assignmentId/u);
  assert.match(dsaNamedPanelSource, /idempotent: true/u);

  const boundaryAt = artifactPrivacySource.indexOf("await assertDsaNamedPanelArtifactBoundary");
  const projectAuthorizationAt = artifactPrivacySource.indexOf(
    "const assigned = await authorizeProjectAccount",
    boundaryAt,
  );
  assert.ok(boundaryAt >= 0 && projectAuthorizationAt > boundaryAt);
  assert.match(workspaceArtifactRouteSource, /readEncryptedArtifact/u);
  assert.doesNotMatch(workspaceArtifactRouteSource, /dsaNamedPanelAssignmentId/u);
  assert.match(dsaNamedPanelSource, /ORDER BY l\.created_at DESC NULLS LAST LIMIT 1 FOR SHARE OF a,u/u);
});

test("adjudication issuance and labeling require exact artifact access", () => {
  assert.match(dsaNamedPanelSource, /issueDsaNamedPanelAdjudicationArtifactLease/u);
  assert.match(dsaNamedPanelSource, /purpose,expires_at,created_by,created_at/u);
  assert.match(dsaNamedPanelSource, /'dsa_named_panel_adjudication'/u);
  assert.match(dsaNamedPanelSource, /tokenless_assurance_access_logs log/u);
  assert.match(dsaNamedPanelSource, /log\.occurred_at>=lease\.created_at/u);
  assert.match(dsaNamedPanelSource, /log\.occurred_at<lease\.expires_at/u);
  assert.match(dsaNamedPanelSource, /log\.occurred_at<lease\.revoked_at/u);
  assert.match(dsaNamedPanelSource, /SET revoked_at=\$2/u);
  assert.match(dsaNamedPanelSource, /dsa_named_panel_adjudicator_artifact_access_required/u);
  assert.match(dsaNamedPanelSource, /artifactAccessLogId/u);
});
