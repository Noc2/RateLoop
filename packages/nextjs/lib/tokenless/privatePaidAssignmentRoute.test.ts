import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("direct assignment routes delegate compensation-aware access and acceptance", () => {
  const source = readFileSync(
    new URL("../../app/api/account/assurance/assignments/[assignmentId]/accept/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /acceptDirectPrivateReviewAssignment/u);
  assert.match(source, /getDirectPrivateReviewAssignmentAccess/u);
  assert.match(source, /getDirectPrivateReviewTaskReviewerAccount/u);
  assert.doesNotMatch(source, /acceptPrivateUnpaidReviewAssignment/u);
});
