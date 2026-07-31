import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const GRANT_ID = "esh_1234567890123456789012";
const SECRET = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
const PACKET = {
  payload: { packetId: "packet-shared", runId: "run-shared" },
  signing: { algorithm: "Ed25519", keyId: "ed25519:shared", publicKey: "shared-public-key" },
  packetDigest: `sha256:${"a".repeat(64)}`,
  signature: "shared-signature",
};

test("the viewer removes the fragment before same-origin POST redemption and prefills the browser verifier", async () => {
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  const requests: Array<{ body: unknown; hashAtFetch: string; method: string; url: string }> = [];
  window.history.replaceState(null, "", `/evidence/share/${GRANT_ID}#${SECRET}`);
  globalThis.fetch = async (input, init) => {
    requests.push({
      body: JSON.parse(String(init?.body)),
      hashAtFetch: window.location.hash,
      method: init?.method ?? "GET",
      url: String(input),
    });
    return Response.json(PACKET);
  };
  const { act, cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { EvidenceShareViewer } = await import("./EvidenceShareViewer");

  try {
    const view = render(<EvidenceShareViewer grantId={GRANT_ID} />);
    await view.findByText("Shared packet");
    assert.deepEqual(requests, [
      {
        body: { secret: SECRET },
        hashAtFetch: "",
        method: "POST",
        url: `/api/evidence/shares/${GRANT_ID}/redeem`,
      },
    ]);
    assert.equal(window.location.hash, "");
    assert.equal(
      (view.getByRole("textbox", { name: "Packet JSON" }) as HTMLTextAreaElement).value,
      JSON.stringify(PACKET, null, 2),
    );
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a link without its fragment fails without making a redemption request", async () => {
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  let called = false;
  window.history.replaceState(null, "", `/evidence/share/${GRANT_ID}`);
  globalThis.fetch = async () => {
    called = true;
    return Response.json(PACKET);
  };
  const { act, cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { EvidenceShareViewer } = await import("./EvidenceShareViewer");

  try {
    const view = render(<EvidenceShareViewer grantId={GRANT_ID} />);
    assert.ok(await view.findByRole("alert"));
    assert.equal(called, false);
    assert.match(view.getByRole("alert").textContent ?? "", /share is unavailable/i);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
