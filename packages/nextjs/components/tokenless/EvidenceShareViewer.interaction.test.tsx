import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import {
  publicEvidenceTrustAnchor,
  signedPublicEvidencePacket,
} from "~~/lib/tokenless/publicEvidenceVerification.fixture";

const GRANT_ID = "esh_1234567890123456789012";
const SECRET = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";

test("the viewer removes the fragment, redeems once, and automatically verifies a safe summary", async () => {
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  const packet = await signedPublicEvidencePacket();
  const requests: Array<{
    body: unknown;
    credentials?: RequestCredentials;
    hashAtFetch: string;
    method: string;
    url: string;
  }> = [];
  window.history.replaceState(null, "", `/evidence/share/${GRANT_ID}#${SECRET}`);
  globalThis.fetch = async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      credentials: init?.credentials,
      hashAtFetch: window.location.hash,
      method: init?.method ?? "GET",
      url: String(input),
    });
    if (String(input) === `/api/evidence/shares/${GRANT_ID}/redeem`) return Response.json(packet);
    if (String(input) === "/api/evidence/trusted-keys") return Response.json(publicEvidenceTrustAnchor(packet));
    throw new Error(`Unexpected evidence-share request: ${String(input)}`);
  };
  const { act, cleanup, render: baseRender, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { EvidenceShareViewer } = await import("./EvidenceShareViewer");

  try {
    const view = render(<EvidenceShareViewer grantId={GRANT_ID} />);
    assert.ok(await view.findByRole("heading", { name: "Packet verified" }));
    const summary = view.getByRole("region", { name: "Is the response supported by the evidence?" });
    assert.ok(within(summary).getByText("Pass"));
    assert.ok(within(summary).getByText("Review result and coverage"));
    assert.ok(within(summary).getByText("Results are hidden because the minimum group size was not met."));
    assert.equal(within(summary).queryByText(/fixture message|unknown fixture/iu), null);
    assert.equal(within(summary).getAllByText("1", { selector: "dd" }).length, 3);
    assert.equal(within(summary).queryByText(packet.signing.keyId), null);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], {
      body: { secret: SECRET },
      credentials: "same-origin",
      hashAtFetch: "",
      method: "POST",
      url: `/api/evidence/shares/${GRANT_ID}/redeem`,
    });
    assert.deepEqual(requests[1], {
      body: null,
      credentials: "omit",
      hashAtFetch: "",
      method: "GET",
      url: "/api/evidence/trusted-keys",
    });
    assert.equal(window.location.hash, "");

    await userEvent.setup({ document }).click(view.getByText("Technical verification details"));
    assert.equal(
      (view.getByRole("textbox", { name: "Packet JSON" }) as HTMLTextAreaElement).value,
      JSON.stringify(packet, null, 2),
    );
    assert.equal(view.getAllByText("Packet verified").length, 2);
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("a trusted-key outage offers retry without redeeming the share twice", async () => {
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  const packet = await signedPublicEvidencePacket();
  let redemptionCalls = 0;
  let keyCalls = 0;
  window.history.replaceState(null, "", `/evidence/share/${GRANT_ID}#${SECRET}`);
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === `/api/evidence/shares/${GRANT_ID}/redeem`) {
      redemptionCalls += 1;
      return Response.json(packet);
    }
    if (url === "/api/evidence/trusted-keys") {
      keyCalls += 1;
      return keyCalls === 1
        ? Response.json({ error: "temporarily unavailable" }, { status: 503 })
        : Response.json(publicEvidenceTrustAnchor(packet));
    }
    throw new Error(`Unexpected evidence-share request: ${url}`);
  };
  const { act, cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { EvidenceShareViewer } = await import("./EvidenceShareViewer");

  try {
    const view = render(<EvidenceShareViewer grantId={GRANT_ID} />);
    assert.ok(await view.findByRole("heading", { name: "Verification is temporarily unavailable" }));
    assert.equal(redemptionCalls, 1);
    assert.equal(keyCalls, 1);
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Retry verification" }));
    assert.ok(await view.findByRole("heading", { name: "Packet verified" }));
    assert.equal(redemptionCalls, 1);
    assert.equal(keyCalls, 2);
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
    throw new Error("Redemption must not run.");
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

test("revoked and unknown share capabilities keep the same unavailable response", async () => {
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  window.history.replaceState(null, "", `/evidence/share/${GRANT_ID}#${SECRET}`);
  globalThis.fetch = async () => Response.json({ error: "gone" }, { status: 410 });
  const { act, cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { EvidenceShareViewer } = await import("./EvidenceShareViewer");

  try {
    const view = render(<EvidenceShareViewer grantId={GRANT_ID} />);
    assert.equal(
      (await view.findByRole("alert")).textContent?.trim(),
      "This evidence share is unavailable. Ask the sender for a new link.",
    );
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
