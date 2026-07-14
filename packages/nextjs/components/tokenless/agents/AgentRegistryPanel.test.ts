import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("agent registry UI labels model identity as declared and versions as immutable", () => {
  const source = readFileSync(new URL("./AgentRegistryPanel.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./AgentVersionForm.tsx", import.meta.url), "utf8");
  assert.match(source, /Durable identities and declared model versions/);
  assert.match(source, /Every version is append-only/);
  assert.match(source, /Version history/);
  assert.match(source, /read-only access/);
  assert.match(source, /setWorkspaceId\(nextWorkspaceId\);\s+setRegistry\(null\);/);
  assert.match(form, /Declared provider/);
  assert.match(form, /Saving creates an immutable version/);
  assert.doesNotMatch(source, /verified model|model accuracy|truth score/i);
});
