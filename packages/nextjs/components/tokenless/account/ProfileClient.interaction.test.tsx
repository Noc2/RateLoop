import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

const PRINCIPAL_ID = `rlp_${"a".repeat(48)}`;

function profile(displayName: string | null) {
  return {
    principalAddress: PRINCIPAL_ID,
    displayName,
    profileDisplayName: displayName,
    providerDisplayName: null,
    updatedAt: displayName ? "2026-07-19T08:00:00.000Z" : null,
  };
}

test("saving a profile name updates the navbar account label without a reload", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ThirdwebSessionButton } = await import("../../thirdweb/ThirdwebSessionButton");
  const { ProfileClient } = await import("./ProfileClient");
  const previousFetch = globalThis.fetch;
  let savedName: string | null = null;
  let sessionReads = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/session") {
      sessionReads += 1;
      return Response.json({
        authenticated: true,
        principalId: PRINCIPAL_ID,
        authProvider: "better_auth:email-otp",
        displayName: savedName,
        expiresAt: "2030-01-01T00:00:00.000Z",
        wallets: { funding: null, payout: null, recovery: null },
      });
    }
    if (url === "/api/account/profile" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { displayName: string };
      savedName = body.displayName.trim() || null;
      return Response.json(profile(savedName));
    }
    if (url === "/api/account/profile") return Response.json(profile(savedName));
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const view = render(
      <>
        <ThirdwebSessionButton compact />
        <ProfileClient />
      </>,
    );
    const screen = within(view.container);
    await waitFor(() => assert.ok(screen.getByText("Your account")));
    assert.equal(screen.getByRole("link", { name: "Wallet settings" }).getAttribute("href"), "/settings/wallets");

    const user = userEvent.setup({ document });
    const displayName = screen.getByRole("textbox", { name: "Display name" });
    await waitFor(() => assert.equal(displayName.hasAttribute("disabled"), false));
    await user.type(displayName, "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => assert.ok(screen.getByText("Ada Lovelace")));
    assert.ok(sessionReads >= 2);
    assert.equal(screen.queryByText("Your account"), null);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("profile validation errors are attached to the display-name field", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ProfileClient } = await import("./ProfileClient");
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    if (String(input) !== "/api/account/profile") throw new Error(`Unexpected request: ${String(input)}`);
    if (init?.method === "PATCH") {
      return Response.json(
        { code: "invalid_profile", field: "displayName", message: "Choose a shorter display name." },
        { status: 400 },
      );
    }
    return Response.json(profile(null));
  };

  try {
    const view = render(<ProfileClient />);
    const screen = within(view.container);
    const input = await screen.findByRole("textbox", { name: "Display name" });
    await waitFor(() => assert.equal(input.hasAttribute("disabled"), false));
    const user = userEvent.setup({ document });
    await user.type(input, "Ada");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => assert.equal(input.getAttribute("aria-invalid"), "true"));
    assert.equal(input.getAttribute("aria-describedby"), "profile-display-name-error");
    assert.ok(screen.getByText("Choose a shorter display name."));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("profile editing waits for the initial profile response", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor, within } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ProfileClient } = await import("./ProfileClient");
  const previousFetch = globalThis.fetch;
  let finishInitialLoad!: (response: Response) => void;
  const initialLoad = new Promise<Response>(resolve => {
    finishInitialLoad = resolve;
  });
  const requests: Array<{ method: string; url: string }> = [];

  globalThis.fetch = async (input, init) => {
    const request = { method: init?.method ?? "GET", url: String(input) };
    requests.push(request);
    if (request.url === "/api/account/profile" && request.method === "GET") return initialLoad;
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  };

  try {
    const view = render(<ProfileClient />);
    const screen = within(view.container);
    const input = screen.getByRole("textbox", { name: "Display name" }) as HTMLInputElement;
    const save = screen.getByRole("button", { name: "Loading profile…" });
    const user = userEvent.setup({ document });

    assert.equal(input.disabled, true);
    assert.equal(save.hasAttribute("disabled"), true);
    await user.type(input, "This must not race the server");
    await user.click(save);
    assert.equal(input.value, "");
    assert.deepEqual(requests, [{ method: "GET", url: "/api/account/profile" }]);

    finishInitialLoad(Response.json(profile("Existing profile name")));
    await waitFor(() => assert.equal(input.value, "Existing profile name"));
    assert.equal(input.disabled, false);
    assert.equal(screen.getByRole("button", { name: "Save profile" }).hasAttribute("disabled"), false);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});
