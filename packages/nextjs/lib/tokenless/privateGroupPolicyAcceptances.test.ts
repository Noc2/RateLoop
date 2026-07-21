import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { requirePrivateGroupPolicyAcceptance } from "~~/lib/tokenless/privateGroupPolicyAcceptances";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const acceptance = {
  workspaceId: "ws_policy_acceptance",
  groupId: "pgrp_policy_acceptance",
  policyVersion: 1,
  policyHash: `sha256:${"1".repeat(64)}`,
  principalAddress: "rlp_reviewer",
  acceptedFromAssignmentId: "hpua_policy_acceptance",
  workspaceReviewerAccessGrantId: "wrg_new",
  workspaceReviewerAccessGrantHash: `sha256:${"2".repeat(64)}`,
  now: new Date("2026-07-21T12:00:00.000Z"),
};

function clientReturning(results: Array<{ rowCount: number; rows: Array<Record<string, unknown>> }>) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const client = {
    async query(sql: string, args: unknown[]) {
      calls.push({ sql, args });
      const result = results.shift();
      if (!result) throw new Error("Unexpected database query.");
      return result;
    },
  } as unknown as PoolClient;
  return { calls, client };
}

test("an acceptance from another reviewer grant is not silently reused", async () => {
  const { calls, client } = clientReturning([{ rowCount: 0, rows: [] }]);
  await assert.rejects(
    () => requirePrivateGroupPolicyAcceptance(client, { ...acceptance, acceptedNow: false }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "confidentiality_acceptance_required",
  );
  assert.match(calls[0]!.sql, /workspace_reviewer_access_grant_id=\$6/u);
  assert.deepEqual(calls[0]!.args.slice(-2), [
    acceptance.workspaceReviewerAccessGrantId,
    acceptance.workspaceReviewerAccessGrantHash,
  ]);
});

test("accepting under a replacement grant rebinds the exact policy acceptance", async () => {
  const { calls, client } = clientReturning([
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [] },
    { rowCount: 1, rows: [{ policy_hash: acceptance.policyHash }] },
  ]);
  const result = await requirePrivateGroupPolicyAcceptance(client, { ...acceptance, acceptedNow: true });
  assert.deepEqual(result, { reused: false });
  assert.match(calls[1]!.sql, /ON CONFLICT \(group_id,policy_version,principal_address\) DO UPDATE SET/u);
  assert.match(calls[1]!.sql, /workspace_reviewer_access_grant_id=EXCLUDED\.workspace_reviewer_access_grant_id/u);
  assert.deepEqual(calls[1]!.args.slice(-2), [
    acceptance.workspaceReviewerAccessGrantId,
    acceptance.workspaceReviewerAccessGrantHash,
  ]);
  assert.match(calls[2]!.sql, /workspace_reviewer_access_grant_hash=\$6/u);
});
