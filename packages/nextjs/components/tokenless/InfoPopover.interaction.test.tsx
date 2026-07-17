import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("info popover supports accessible interaction and viewport-safe placement", async () => {
  const restoreDom = installTestDom();
  const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { InfoPopover } = await import("./InfoPopover");
  const originalRect = HTMLElement.prototype.getBoundingClientRect;

  try {
    render(<InfoPopover label="About review routing">Routing help</InfoPopover>);
    const trigger = screen.getByRole("button", { name: "About review routing" });
    const user = userEvent.setup();

    assert.match(trigger.className, /size-11/);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(trigger.hasAttribute("aria-controls"), false);
    assert.equal(trigger.hasAttribute("aria-describedby"), false);

    await user.click(trigger);
    const tooltip = screen.getByRole("tooltip");
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(trigger.getAttribute("aria-controls"), tooltip.id);
    assert.equal(trigger.getAttribute("aria-describedby"), tooltip.id);
    assert.equal(tooltip.tabIndex, -1);
    assert.equal(tooltip.querySelector("button, a, input, select, textarea"), null);

    await user.click(trigger);
    assert.equal(screen.queryByRole("tooltip"), null);

    trigger.focus();
    await user.keyboard("{Enter}");
    assert.ok(screen.getByRole("tooltip"));
    await user.keyboard("{Escape}");
    await waitFor(() => assert.equal(screen.queryByRole("tooltip"), null));
    assert.equal(document.activeElement, trigger);

    await user.keyboard(" ");
    assert.ok(screen.getByRole("tooltip"));

    fireEvent.pointerDown(document.body);
    await waitFor(() => assert.equal(screen.queryByRole("tooltip"), null));

    cleanup();
    const viewportWidth = 240;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: viewportWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.getAttribute("role") === "tooltip") {
        return { bottom: 108, height: 96, left: 0, right: 288, top: 12, width: 288, x: 0, y: 12, toJSON() {} };
      }
      if (this.tagName === "BUTTON") {
        return {
          bottom: 56,
          height: 44,
          left: 210,
          right: 254,
          top: 12,
          width: 44,
          x: 210,
          y: 12,
          toJSON() {},
        };
      }
      return originalRect.call(this);
    };

    render(
      <div style={{ overflow: "hidden", width: 120 }}>
        <InfoPopover label="About review routing">Routing help</InfoPopover>
      </div>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "About review routing" }));
    const positionedTooltip = screen.getByRole("tooltip");

    await waitFor(() => assert.equal(positionedTooltip.style.visibility, "visible"));
    assert.match(positionedTooltip.className, /fixed/);
    assert.match(positionedTooltip.className, /max-h-\[calc\(100dvh-2rem\)\]/);
    assert.equal(Number.parseFloat(positionedTooltip.style.left), 16);
    assert.equal(Number.parseFloat(positionedTooltip.style.width), 208);
    assert.ok(
      Number.parseFloat(positionedTooltip.style.left) + Number.parseFloat(positionedTooltip.style.width) <=
        viewportWidth - 16,
    );
    assert.equal(Number.parseFloat(positionedTooltip.style.top), 64);
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    cleanup();
    restoreDom();
  }
});
