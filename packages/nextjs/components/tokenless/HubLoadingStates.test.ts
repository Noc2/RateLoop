import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("human and agent hubs use shared skeleton loading states", async () => {
  const files = await Promise.all(
    [
      "./answer/AnswerPageClient.tsx",
      "./agents/AgentConnectionPanel.tsx",
      "./agents/AgentRegistryPanel.tsx",
      "./agents/AgentReviewsPanel.tsx",
      "./agents/EvaluationDashboardPanel.tsx",
      "./agents/EvidenceWorkspacePanel.tsx",
      "../../app/(app)/human/loading.tsx",
      "../../app/(app)/agents/loading.tsx",
    ].map(path => readFile(new URL(path, import.meta.url), "utf8")),
  );

  for (const source of files) assert.match(source, /<AsyncSection[\s\S]*loading/);
  assert.doesNotMatch(files.join("\n"), /loading loading-spinner/);
});
