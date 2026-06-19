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

const publicDocs = {
  "packages/nextjs/public/docs/ai.md": readFileSync(
    new URL("../packages/nextjs/public/docs/ai.md", import.meta.url),
    "utf8",
  ),
  "packages/nextjs/public/docs/sdk.md": readFileSync(
    new URL("../packages/nextjs/public/docs/sdk.md", import.meta.url),
    "utf8",
  ),
  "packages/nextjs/public/llms.txt": readFileSync(
    new URL("../packages/nextjs/public/llms.txt", import.meta.url),
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

test("static public docs identify Base mainnet production and Base Sepolia staging", () => {
  for (const [file, content] of Object.entries(publicDocs)) {
    assert.match(content, /Base mainnet.*8453|8453.*Base mainnet/i, file);
    assert.match(content, /Base Sepolia.*84532|84532.*Base Sepolia/i, file);
  }
});

test("static agent docs keep no-payment dry-run guidance", () => {
  for (const file of ["packages/nextjs/public/docs/ai.md", "packages/nextjs/public/llms.txt"]) {
    const content = publicDocs[file];
    assert.match(content, /dryRun: true/, file);
    assert.match(content, /dry_run|rateloop-agents sandbox/, file);
  }
});
