import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("private text is fetched in-page and long content expands without opening a tab", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { PrivateArtifactPreview } = await import("./PrivateArtifactPreview");
  const previousFetch = globalThis.fetch;
  const content = `Exact agent response: ${"useful detail ".repeat(100)}`;
  const requests: Array<{ input: string; cache?: RequestCache; credentials?: RequestCredentials }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), cache: init?.cache, credentials: init?.credentials });
    return new Response(content, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  };

  try {
    const view = render(
      <PrivateArtifactPreview artifactUrl="/private/exact-output" label="Agent output" onRefreshAccess={() => {}} />,
    );
    await waitFor(() => assert.ok(view.getByText(/Exact agent response:/u)));
    assert.deepEqual(requests, [{ input: "/private/exact-output", cache: "no-store", credentials: "same-origin" }]);
    assert.equal(view.queryByRole("link", { name: /open/u }), null);
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Show more" }));
    const dialog = view.getByRole("dialog", { name: "Agent output" });
    assert.ok(dialog.textContent?.includes(content));
    await userEvent.setup({ document }).keyboard("{Escape}");
    await waitFor(() => assert.equal(view.queryByRole("dialog"), null));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("expired preview access renews and refetches without losing the review page", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { PrivateArtifactPreview } = await import("./PrivateArtifactPreview");
  const previousFetch = globalThis.fetch;
  let reads = 0;
  let renewals = 0;
  globalThis.fetch = async () => {
    reads += 1;
    return reads === 1
      ? Response.json({ error: "expired" }, { status: 410 })
      : new Response("Restored exact content", { headers: { "Content-Type": "text/plain" } });
  };

  try {
    const view = render(
      <PrivateArtifactPreview
        artifactUrl="/private/renew"
        label="Source"
        onRefreshAccess={async () => {
          renewals += 1;
        }}
      />,
    );
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Refresh access" })));
    await userEvent.setup({ document }).click(view.getByRole("button", { name: "Refresh access" }));
    await waitFor(() => assert.ok(view.getByText("Restored exact content")));
    assert.equal(renewals, 1);
    assert.equal(reads, 2);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
