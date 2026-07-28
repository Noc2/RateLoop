import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("segmented choices expose selection without primary-action styling", async () => {
  const restoreDom = installTestDom();
  const { act, cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { SegmentedChoice } = await import("./SegmentedChoice");
  const changes: string[] = [];

  try {
    const view = render(
      <SegmentedChoice
        value="off"
        options={[
          { value: "off", label: "No bonus" },
          { value: "on", label: "Add bonus" },
        ]}
        onChange={value => changes.push(value)}
      />,
    );
    const off = view.getByRole("button", { name: "No bonus" });
    const on = view.getByRole("button", { name: "Add bonus" });

    assert.equal(off.getAttribute("aria-pressed"), "true");
    assert.equal(on.getAttribute("aria-pressed"), "false");
    assert.equal(off.className.includes("btn-primary"), false);
    await userEvent.setup({ document }).click(on);
    assert.deepEqual(changes, ["on"]);
  } finally {
    await act(async () => cleanup());
    restoreDom();
  }
});
