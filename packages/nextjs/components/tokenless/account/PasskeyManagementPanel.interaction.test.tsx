import React from "react";
import axe from "axe-core";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("passkey management exposes named controls and blocks removal of the last factor", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const { PasskeyManagementPanel } = await import("./PasskeyManagementPanel");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === "/api/account/passkeys") {
      return Response.json({
        canRemoveLast: false,
        passkeys: [
          {
            backedUp: true,
            createdAt: "2026-07-19T10:00:00.000Z",
            deviceType: "singleDevice",
            id: "pk_1",
            name: "MacBook",
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${String(input)}`);
  };

  try {
    const view = render(<PasskeyManagementPanel />);
    await waitFor(() => assert.ok(view.getByText("MacBook")));
    assert.ok(view.getByRole("button", { name: "Add passkey" }));
    assert.equal(view.getByRole("button", { name: "Remove MacBook" }).hasAttribute("disabled"), true);
    assert.ok(view.getByText("Add another passkey before removing this one."));
    assert.ok(view.getByRole("list", { name: "Your passkeys" }));
    const result = await axe.run(view.container, { rules: { "color-contrast": { enabled: false } } });
    assert.equal(result.violations.length, 0, JSON.stringify(result.violations.map(item => item.id)));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("passkey mutations require matching-account reauthentication and keep credentials out of storage", () => {
  const source = readFileSync(new URL("./PasskeyManagementPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /betterAuthClient\.passkey\.addPasskey/);
  assert.doesNotMatch(source, /betterAuthClient\.passkey\.deletePasskey/);
  assert.match(source, /betterAuthClient\.signIn\.passkey/);
  assert.match(source, /betterAuthClient\.emailOtp\.sendVerificationOtp/);
  assert.match(source, /"\/api\/account\/passkeys"/);
  assert.match(source, /x-rateloop-passkey-action-proof/);
  assert.match(source, /method: "DELETE"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
