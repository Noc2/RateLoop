import React, { useState } from "react";
import axe from "axe-core";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("wallet setup presents direct purpose-specific actions with accessible selected state", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const userEvent = (await import("@testing-library/user-event")).default;
  const { WalletPurposeChooser } = await import("./WalletBindingsClient");

  function Harness() {
    const [purpose, setPurpose] = useState<"funding" | "payout">("payout");
    return <WalletPurposeChooser purpose={purpose} onSelect={setPurpose} />;
  }

  try {
    const view = render(<Harness />);
    const user = userEvent.setup({ document });
    const payout = view.getByRole("button", { name: /Receive reviewer payouts/ });
    const funding = view.getByRole("button", { name: /Pay for public asks/ });
    assert.equal(payout.getAttribute("aria-pressed"), "true");
    assert.equal(funding.getAttribute("aria-pressed"), "false");

    await user.click(funding);
    assert.equal(funding.getAttribute("aria-pressed"), "true");
    assert.equal(payout.getAttribute("aria-pressed"), "false");
    assert.equal(view.queryByRole("button", { name: /Recover account access/ }), null);
    assert.equal(view.container.querySelector("select"), null);

    const result = await axe.run(view.container, { rules: { "color-contrast": { enabled: false } } });
    assert.equal(result.violations.length, 0, JSON.stringify(result.violations.map(item => item.id)));
  } finally {
    cleanup();
    restoreDom();
  }
});

test("wallet bindings distinguish loading from empty and expose specific removal names", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render: baseRender } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { WalletBindingList } = await import("./WalletBindingsClient");
  const bindings = [
    {
      bindingId: "wallet_funding",
      purpose: "funding" as const,
      source: "self_custodial" as const,
      walletAddress: "0x1111111111111111111111111111111111111111",
    },
    {
      bindingId: "wallet_payout",
      purpose: "payout" as const,
      source: "self_custodial" as const,
      walletAddress: "0x2222222222222222222222222222222222222222",
    },
  ];

  try {
    const view = render(
      <WalletBindingList bindings={[]} busy={false} loadState="loading" onRevoke={() => undefined} />,
    );
    assert.ok(view.getByRole("status", { name: "" }).textContent?.includes("Loading wallets"));
    assert.equal(view.queryByText("No wallet is attached to this account."), null);

    view.rerender(<WalletBindingList bindings={bindings} busy={false} loadState="ready" onRevoke={() => undefined} />);
    assert.ok(view.getByRole("button", { name: "Remove Pay for public asks wallet 0x1111…1111" }));
    assert.ok(view.getByRole("button", { name: "Remove Receive reviewer payouts wallet 0x2222…2222" }));
    assert.equal(view.queryByRole("button", { name: "Remove" }), null);
  } finally {
    cleanup();
    restoreDom();
  }
});
