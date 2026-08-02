import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AgentTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("account deletion starts from a visible action and loads its review on demand", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AccountDeletionPanel } = await import("./AccountDeletionPanel");
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    return Response.json({
      blockers: [
        {
          code: "owned_workspaces_require_resolution",
          message: "Delete or transfer every workspace you own first.",
        },
      ],
      impact: {
        ownedWorkspaces: 0,
        sharedWorkspaces: 1,
        acceptedAssignments: 0,
        managedWallets: 0,
        retainedRecords: [
          {
            code: "completed_paid_work",
            message: "Completed paid-work and settlement evidence for the applicable legal retention period",
          },
        ],
      },
      warnings: [
        {
          code: "fresh_account_after_sign_in",
          message:
            "Signing in again creates a new account and does not restore this account, its access, or its history.",
        },
      ],
    });
  };

  try {
    const view = baseRender(<AccountDeletionPanel />, {
      wrapper: ({ children }) => <AgentTestProviders locale="de">{children}</AgentTestProviders>,
    });
    const user = userEvent.setup({ document });
    assert.equal(view.container.querySelector("details"), null);
    assert.equal(view.queryByLabelText("Type DELETE to confirm"), null);

    await user.click(view.getByRole("button", { name: "Kontolöschung prüfen" }));

    await waitFor(() => assert.ok(view.getByText("Abgeschlossene bezahlte Arbeit", { exact: false })));
    assert.deepEqual(calls, ["/api/account/deletion"]);
    assert.ok(view.getByText("Lösche oder übertrage zuerst jeden Workspace", { exact: false }));
    assert.ok(view.getByText("Eine erneute Anmeldung erstellt ein neues Konto", { exact: false }));
    assert.equal(view.queryByText("Delete or transfer every workspace you own first."), null);
    assert.equal(
      view.queryByText(
        "Signing in again creates a new account and does not restore this account, its access, or its history.",
      ),
      null,
    );

    await user.click(view.getByRole("button", { name: "Abbrechen" }));
    assert.ok(view.getByRole("button", { name: "Kontolöschung prüfen" }));
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("account deletion requires fresh OTP or passkey proof kept only in memory", () => {
  const source = [
    readFileSync(new URL("./AccountDeletionPanel.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../../../messages/en/account.json", import.meta.url), "utf8"),
  ].join("\n");
  assert.match(source, /Verify and delete/);
  assert.match(source, /betterAuthClient\.emailOtp\.sendVerificationOtp/);
  assert.match(source, /betterAuthClient\.signIn\.passkey/);
  assert.match(source, /issueAccountDeletionProof\(\)/);
  assert.match(source, /JSON\.stringify\(\{ confirmation: "DELETE", recentAuthProof \}\)/);
  assert.match(source, /betterAuthClient\.signOut/);
  assert.doesNotMatch(source, /response\.error\.message/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
