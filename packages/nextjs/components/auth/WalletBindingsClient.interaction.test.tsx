import React, { useState } from "react";
import axe from "axe-core";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("wallet setup presents direct purpose-specific actions with accessible selected state", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render } = await import("@testing-library/react");
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
