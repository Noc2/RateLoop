import assert from "node:assert/strict";
import test from "node:test";
import { assertDsaNamedPanelPrincipalEligible } from "~~/lib/tokenless/dsaNamedPanelEligibility";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

function client(row: Record<string, unknown> | undefined) {
  const queries: { text: string; values: unknown[] }[] = [];
  return {
    queries,
    client: {
      async query(text: string, values: unknown[]) {
        queries.push({ text, values });
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      },
    },
  };
}

test("named-panel eligibility rejects workspace authority and active artifact-reading project roles", async () => {
  for (const row of [
    { has_workspace_authority: true, has_project_access: false },
    { has_workspace_authority: false, has_project_access: true },
    { has_workspace_authority: false, has_project_access: false, authored_reference_definition: true },
    undefined,
  ]) {
    const database = client(row);
    await assert.rejects(
      () =>
        assertDsaNamedPanelPrincipalEligible(database.client as never, {
          workspaceId: "ws_test",
          projectId: "project_test",
          epochId: `rse_${"a".repeat(40)}`,
          principalId: "pri_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          now: new Date("2030-01-01T00:00:00.000Z"),
        }),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "dsa_named_panel_reviewer_access_conflict",
    );
  }
});

test("named-panel eligibility binds every consumer to exact active authority boundaries", async () => {
  const database = client({
    has_workspace_authority: false,
    has_project_access: false,
    authored_reference_definition: false,
  });
  await assertDsaNamedPanelPrincipalEligible(database.client as never, {
    workspaceId: "ws_test",
    projectId: "project_test",
    epochId: `rse_${"a".repeat(40)}`,
    principalId: "pri_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    now: new Date("2030-01-01T00:00:00.000Z"),
  });
  assert.doesNotMatch(database.queries[0]!.text, /member\.role IN/u);
  assert.match(database.queries[0]!.text, /access\.subject_kind='principal'/u);
  assert.doesNotMatch(database.queries[0]!.text, /access\.role IN/u);
  assert.match(database.queries[0]!.text, /access\.status='active'/u);
  assert.match(database.queries[0]!.text, /access\.expires_at IS NULL OR access\.expires_at>\$5/u);
  assert.match(database.queries[0]!.text, /definition\.created_by=\$4/u);
});
