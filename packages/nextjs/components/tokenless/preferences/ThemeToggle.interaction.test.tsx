import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";

test("theme toggle follows the OS until a light or dark override is chosen", async () => {
  const restoreDom = installTestDom();
  const listeners = new Set<() => void>();
  const systemPrefersDark = true;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      get matches() {
        return systemPrefersDark;
      },
      media: "(prefers-color-scheme: dark)",
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }),
  });
  const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
  const { ThemeToggle } = await import("./ThemeToggle");

  try {
    const view = render(
      <ThemeToggle
        darkActiveLabel="Dunkles Design aktiv"
        lightActiveLabel="Helles Design aktiv"
        switchToDarkLabel="Zum dunklen Design wechseln"
        switchToLightLabel="Zum hellen Design wechseln"
      />,
    );

    assert.ok(await view.findByRole("button", { name: "Zum hellen Design wechseln" }));
    assert.equal(document.documentElement.dataset.theme, undefined);
    assert.equal(document.cookie, "");

    fireEvent.click(view.getByRole("button"));
    assert.equal(document.documentElement.dataset.theme, "light");
    assert.match(document.cookie, /(?:^|;\s*)rateloop-theme=light(?:;|$)/);
    assert.ok(view.getByRole("button", { name: "Zum dunklen Design wechseln" }));
    assert.match(view.getByText("Helles Design aktiv").textContent ?? "", /Helles Design aktiv/);

    await act(async () => {
      for (const listener of listeners) listener();
    });
    assert.equal(document.documentElement.dataset.theme, "light");
    assert.ok(view.getByRole("button", { name: "Zum dunklen Design wechseln" }));
  } finally {
    await act(async () => cleanup());
    restoreDom();
  }
});
