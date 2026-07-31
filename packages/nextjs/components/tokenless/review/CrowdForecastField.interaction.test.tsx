import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { withEnglishAppTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("the shared crowd forecast starts unset and reveals its slider only after an exact value", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render: baseRender, screen } = await import("@testing-library/react");
  const render = withEnglishAppTestProviders(baseRender);
  const { CrowdForecastField } = await import("./CrowdForecastField");
  let value: number | null = null;
  try {
    const view = render(
      <CrowdForecastField
        positiveLabel="Accept"
        privacyContext="private_unpaid"
        value={value}
        onChange={next => {
          value = next;
        }}
      />,
    );
    const input = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Crowd forecast" });
    assert.equal(input.value, "");
    assert.equal(screen.queryByRole("slider"), null);
    assert.match(screen.getByText(/No forecast is preselected/u).textContent ?? "", /No forecast is preselected/u);

    fireEvent.change(input, { target: { value: "73" } });
    view.rerender(
      <CrowdForecastField
        positiveLabel="Accept"
        privacyContext="private_unpaid"
        value={value}
        onChange={next => (value = next)}
      />,
    );
    assert.equal(screen.getByRole<HTMLInputElement>("slider", { name: "Crowd forecast slider" }).value, "73");
  } finally {
    cleanup();
    restoreDom();
  }
});
