import { __setDatabaseResourcesForTests, dbClient } from ".";
import { createMemoryDatabaseResources } from "./testing/testMemory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createWorkspace } from "~~/lib/tokenless/productCore";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("0051 stores setup evidence without secrets and backfills connected workspaces", () => {
  const migration = readFileSync(join(process.cwd(), "drizzle", "0051_workspace_agent_setup.sql"), "utf8");

  assert.match(migration, /CREATE TABLE "tokenless_workspace_agent_setups"/);
  assert.match(migration, /'grandfathered'/);
  assert.match(migration, /primary_connection_intent_id/);
  assert.match(migration, /activation_mode.*legacy_pairing/s);
  assert.doesNotMatch(migration, /claim_fragment|oauth_token|api_credential|invite_token|question_content/);
});

test("new workspace creation atomically starts guided agent setup", async () => {
  const { workspaceId } = await createWorkspace({
    name: "Guided setup",
    ownerAddress: "0x0000000000000000000000000000000000000051",
  });

  const result = await dbClient.execute({
    sql: `SELECT status,current_step,revision,review_draft_json
          FROM tokenless_workspace_agent_setups WHERE workspace_id = ?`,
    args: [workspaceId],
  });

  assert.equal(result.rowCount, 1);
  assert.deepEqual(
    {
      currentStep: String(result.rows[0]?.current_step),
      reviewDraft: String(result.rows[0]?.review_draft_json),
      revision: Number(result.rows[0]?.revision),
      status: String(result.rows[0]?.status),
    },
    { currentStep: "connect", reviewDraft: "{}", revision: 1, status: "in_progress" },
  );
});
