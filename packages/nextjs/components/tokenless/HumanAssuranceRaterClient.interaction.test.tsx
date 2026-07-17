import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("private-review credentials stay behind a manual fallback", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, screen } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { HumanAssuranceRaterClient } = await import("./HumanAssuranceRaterClient");

  try {
    render(<HumanAssuranceRaterClient />);
    assert.equal(screen.queryByLabelText("Assignment ID"), null);
    assert.equal(screen.queryByLabelText("Confidentiality terms hash"), null);
    await userEvent.setup().click(screen.getByRole("button", { name: "Enter details manually" }));
    assert.ok(screen.getByLabelText("Assignment ID"));
    assert.ok(screen.getByLabelText("Confidentiality terms hash"));
  } finally {
    cleanup();
    restoreDom();
  }
});

test("private-review links carry both invitation credentials", () => {
  const page = readFileSync(new URL("../../app/(app)/human/page.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("./answer/PrivateAssignmentCard.tsx", import.meta.url), "utf8");
  assert.match(page, /initialAssignmentId=\{params\.assignment\}/);
  assert.match(page, /initialTermsHash=\{params\.terms\}/);
  assert.match(card, /assignment=\$\{encodeURIComponent\(assignment\.assignmentId\)\}/);
  assert.match(card, /terms=\$\{encodeURIComponent\(assignment\.confidentialityTermsHash \?\? ""\)\}/);
});
