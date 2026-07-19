import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("agent context and owner guidance disclose the actual enforcement and reporting boundary", () => {
  const contextSource = readFileSync(new URL("./effectiveAgentReviewContext.ts", import.meta.url), "utf8");
  const guide = readFileSync(
    new URL("../../../../docs/tokenless-agent-human-review-owner-guide.md", import.meta.url),
    "utf8",
  );

  assert.equal((contextSource.match(/enforcementBoundary: bound\.enforcementMode/gu) ?? []).length, 2);
  assert.match(guide, /agent or its host reports that an eligible output occurred/iu);
  assert.match(guide, /cannot independently detect a missing evaluation call/iu);
  assert.match(guide, /maximum-unreviewed-gap counter therefore covers reported\s+eligible outputs only/iu);
  assert.match(guide, /host-enforced[^\n]+separately verified adapter/iu);
});
