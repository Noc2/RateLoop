import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("an account holder can request, refresh, and download a completed subject export", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { SubjectDataExportPanel } = await import("./SubjectDataExportPanel");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ body: string | null; method: string; url: string }> = [];
  let completed = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ body: init?.body ? String(init.body) : null, method: init?.method ?? "GET", url });
    if (init?.method === "POST") {
      completed = true;
      return Response.json({ requestId: "dsr_export_1", dueAt: "2026-08-25T00:00:00.000Z" }, { status: 202 });
    }
    return Response.json({
      requests: completed
        ? [
            {
              requestId: "dsr_export_1",
              requestType: "export",
              status: "completed",
              receivedAt: "2026-07-26T00:00:00.000Z",
              dueAt: "2026-08-25T00:00:00.000Z",
              completedAt: "2026-07-26T00:01:00.000Z",
              exportReady: true,
              exportDeleteAfter: "2026-08-02T00:01:00.000Z",
            },
          ]
        : [],
    });
  };

  try {
    const view = render(<SubjectDataExportPanel />);
    assert.ok(view.getByRole("button", { name: "About data exports" }));
    assert.equal(view.queryByText(/authenticated JSON copy/u), null);
    const request = await view.findByRole("button", { name: "Request data export" });
    await userEvent.setup({ document }).click(request);
    const download = await view.findByRole("link", { name: "Download JSON" });
    assert.equal(download.getAttribute("href"), "/api/account/privacy/subject-requests/dsr_export_1/export");
    await waitFor(() => assert.equal(calls.length, 3));
    assert.deepEqual(calls[1], {
      body: JSON.stringify({ requestType: "export" }),
      method: "POST",
      url: "/api/account/privacy/subject-requests",
    });
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
