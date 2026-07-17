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
    const authority = screen.getByRole("combobox", { name: authorityName }) as HTMLSelectElement;

    assert.equal(frequency.value, "adaptive");
    assert.equal(authority.value, "check_only");

    await user.selectOptions(frequency, "manual");
    assert.equal((screen.getByRole("combobox", { name: frequencyName }) as HTMLSelectElement).value, "manual");
    assert.equal(screen.queryByRole("combobox", { name: authorityName }), null);
    assert.ok(screen.getByText("Never requires review automatically. You start each handoff."));

    await user.selectOptions(screen.getByRole("combobox", { name: frequencyName }), "always");
    assert.equal((screen.getByRole("combobox", { name: authorityName }) as HTMLSelectElement).value, "check_only");
  } finally {
    cleanup();
    restoreDom();
  }
});
