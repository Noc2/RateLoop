import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0159_dashboard_window_indexes.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("dashboard time windows use workspace-first indexes on every high-volume source", () => {
  assert.match(
    migration,
    /tokenless_agent_evaluation_observations_workspace_finalized_idx"[\s\S]*\("workspace_id","finalized_at"\)/u,
  );
  assert.match(
    migration,
    /tokenless_agent_review_transition_events_workspace_occurred_idx"[\s\S]*\("workspace_id","occurred_at"\)/u,
  );
  assert.match(
    migration,
    /tokenless_agent_review_opportunities_workspace_created_idx"[\s\S]*\("workspace_id","created_at"\)/u,
  );
  assert.deepEqual(journal.entries.at(-1), {
    idx: 159,
    version: "7",
    when: 1785222000000,
    tag: "0159_dashboard_window_indexes",
    breakpoints: true,
  });
});
