import React, { useState } from "react";
import type { ReviewRoutingAuthority, ReviewRoutingMode } from "./ReviewRoutingFields";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("manual handoff hides authority and keeps check only when automatic routing resumes", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, screen } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { ReviewRoutingFields, reviewRoutingStateForMode } = await import("./ReviewRoutingFields");

  function Harness() {
    const [routing, setRouting] = useState<{
      mode: ReviewRoutingMode;
      authority: ReviewRoutingAuthority;
    }>({ mode: "adaptive", authority: "check_only" });
    return (
      <ReviewRoutingFields
        mode={routing.mode}
        authority={routing.authority}
        automaticAvailable={false}
        automaticUnavailableReason="Create an exact owner-approved publishing grant first."
        requiresFundingPermission={false}
        onModeChange={mode => setRouting(current => reviewRoutingStateForMode(mode, current.authority))}
        onAuthorityChange={authority => setRouting(current => ({ ...current, authority }))}
      />
    );
  }

  try {
    render(<Harness />);
    const user = userEvent.setup();
    const frequencyName = "When should RateLoop require human review?";
    const authorityName = "If review is required, what may the agent do?";
    const frequency = screen.getByRole("combobox", { name: frequencyName }) as HTMLSelectElement;
    const authorityGroup = screen.getByRole("group", { name: authorityName });
    const checkOnly = screen.getByRole("radio", { name: "Check only" }) as HTMLInputElement;
    const prepare = screen.getByRole("radio", { name: "Prepare for approval" }) as HTMLInputElement;
    const automatic = screen.getByRole("radio", { name: "Send automatically" }) as HTMLInputElement;

    assert.equal(frequency.value, "adaptive");
    assert.ok(authorityGroup);
    assert.equal(checkOnly.checked, true);
    assert.match(checkOnly.getAttribute("aria-describedby") ?? "", /check_only-description/);
    assert.equal(prepare.disabled, false);
    assert.equal(automatic.disabled, true);
    assert.match(automatic.getAttribute("aria-describedby") ?? "", /automatic-unavailable/);
    assert.ok(screen.getByText("Unavailable: Create an exact owner-approved publishing grant first."));

    await user.click(prepare);
    assert.equal((screen.getByRole("radio", { name: "Prepare for approval" }) as HTMLInputElement).checked, true);
    await user.click(automatic);
    assert.equal((screen.getByRole("radio", { name: "Prepare for approval" }) as HTMLInputElement).checked, true);

    await user.selectOptions(frequency, "manual");
    assert.equal((screen.getByRole("combobox", { name: frequencyName }) as HTMLSelectElement).value, "manual");
    assert.equal(screen.queryByRole("group", { name: authorityName }), null);
    assert.ok(screen.getByText("Never requires review automatically. You start each handoff."));

    await user.selectOptions(screen.getByRole("combobox", { name: frequencyName }), "always");
    assert.equal((screen.getByRole("radio", { name: "Check only" }) as HTMLInputElement).checked, true);
  } finally {
    cleanup();
    restoreDom();
  }
});
