import { resolveFlowSlowStatus, resolveFlowSubmittingStatus } from "./transactionFlowToast";
import assert from "node:assert/strict";
import test from "node:test";

test("resolveFlowSubmittingStatus uses sponsored copy when sponsored", () => {
  assert.deepEqual(resolveFlowSubmittingStatus({ action: "rewards", sponsored: true }), {
    title: "Submitting rewards",
    description: "Sponsored transactions can take up to a minute.",
  });
});

test("resolveFlowSubmittingStatus uses wallet copy when self-funded", () => {
  const status = resolveFlowSubmittingStatus({ action: "vote", sponsored: false });
  assert.equal(status.title, "Submitting vote");
  assert.match(status.description, /few seconds/i);
});

test("resolveFlowSlowStatus uses sponsored slow copy when sponsored", () => {
  assert.deepEqual(resolveFlowSlowStatus({ action: "rewards", sponsored: true }), {
    title: "Still submitting rewards",
    description: "Sponsored transactions can take up to a minute.",
  });
});
