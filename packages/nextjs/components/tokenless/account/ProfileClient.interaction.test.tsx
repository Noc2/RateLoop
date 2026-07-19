import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
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
  const { cleanup, render, waitFor, within } = await import("@testing-library/react");
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

    const user = userEvent.setup({ document });
    await user.type(screen.getByRole("textbox", { name: "Display name" }), "Ada Lovelace");
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
