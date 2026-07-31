import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("invalid pasted JSON fails locally without contacting a server", async () => {
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("Unexpected request.");
  };
  const { act, cleanup, fireEvent, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { PublicEvidenceVerifier } = await import("./PublicEvidenceVerifier");

  try {
    const view = render(<PublicEvidenceVerifier />);
    fireEvent.change(view.getByLabelText("Packet JSON"), { target: { value: "{broken" } });
    fireEvent.click(view.getByRole("button", { name: "Verify packet" }));

    assert.match((await view.findByRole("alert")).textContent ?? "", /not valid JSON/);
    assert.equal(fetchCount, 0);
    assert.ok(view.getByLabelText("Choose JSON file"));
    assert.match(view.getByText(/Your packet stays in this browser/).textContent ?? "", /does not upload, store/);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
