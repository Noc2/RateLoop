import { buildCleanHandoffLocationPath, readHandoffTokenFromLocation } from "./handoffLocation";
import assert from "node:assert/strict";
import test from "node:test";

test("reads the canonical handoff token from the URL fragment", () => {
  assert.equal(
    readHandoffTokenFromLocation(new URL("https://www.rateloop.ai/agent/handoff/ahf_1#token=secret")),
    "secret",
  );
});

test("falls back to AI-rewritten query token handoff links", () => {
  assert.equal(
    readHandoffTokenFromLocation(new URL("https://www.rateloop.ai/agent/handoff/ahf_1?token=secret")),
    "secret",
  );
});

test("prefers the fragment token when both token locations are present", () => {
  assert.equal(
    readHandoffTokenFromLocation(
      new URL("https://www.rateloop.ai/agent/handoff/ahf_1?token=query-token#token=fragment-token"),
    ),
    "fragment-token",
  );
});

test("cleans query token handoff links while preserving unrelated URL state", () => {
  assert.equal(
    buildCleanHandoffLocationPath(
      new URL("https://www.rateloop.ai/agent/handoff/ahf_1?tab=review&token=secret#details"),
    ),
    "/agent/handoff/ahf_1?tab=review#details",
  );
});

test("cleans fragment token handoff links while preserving unrelated query params", () => {
  assert.equal(
    buildCleanHandoffLocationPath(
      new URL("https://www.rateloop.ai/agent/handoff/ahf_1?tab=review#token=secret&view=details"),
    ),
    "/agent/handoff/ahf_1?tab=review#view=details",
  );
});

test("does not rewrite handoff links without a token", () => {
  assert.equal(buildCleanHandoffLocationPath(new URL("https://www.rateloop.ai/agent/handoff/ahf_1?tab=review")), null);
});
