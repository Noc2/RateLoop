import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const activeDocs = {
  "docs/use-cases-2026-06.md": readFileSync(
    new URL("../docs/use-cases-2026-06.md", import.meta.url),
    "utf8",
  ),
  "docs/agent-to-agent-acceptance-oracle-2026-06.md": readFileSync(
    new URL(
      "../docs/agent-to-agent-acceptance-oracle-2026-06.md",
      import.meta.url,
    ),
    "utf8",
  ),
};

test("active public docs avoid stale World Chain and mandatory credential copy", () => {
  for (const [file, content] of Object.entries(activeDocs)) {
    assert.doesNotMatch(content, /World App rater base/i, file);
    assert.doesNotMatch(content, /World ID-gated/i, file);
    assert.doesNotMatch(content, /World Chain ~2s blocks/i, file);
  }
});
