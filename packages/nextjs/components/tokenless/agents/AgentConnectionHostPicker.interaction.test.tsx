import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import { TOKENLESS_HOST_CAPABILITIES, type TokenlessHostId } from "~~/lib/tokenless/hostCapabilities";

test("every registry host renders as a chip; selecting tunes and reselecting deselects", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, within } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const { AgentConnectionHostPicker } = await import("./AgentConnectionHostPicker");
  const selections: (TokenlessHostId | null)[] = [];

  try {
    render(<AgentConnectionHostPicker selectedHostId="claude-code" onSelectHost={hostId => selections.push(hostId)} />);
    const screen = within(document.body);
    for (const host of TOKENLESS_HOST_CAPABILITIES) {
      assert.ok(screen.getByRole("button", { name: host.displayName }), host.id);
    }
    assert.ok(screen.getByRole("button", { name: "Claude Code", pressed: true }));
    assert.ok(screen.getByRole("button", { name: "Other MCP client", pressed: false }));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Gemini CLI" }));
    await user.click(screen.getByRole("button", { name: "Claude Code" }));
    assert.deepEqual(selections, ["gemini-cli", null]);
  } finally {
    cleanup();
    restoreDom();
  }
});

test("a selected host shows its honest tier meaning and numbered host prompts", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, within } = await import("@testing-library/react");
  const { AgentConnectionHostPicker } = await import("./AgentConnectionHostPicker");

  try {
    render(<AgentConnectionHostPicker selectedHostId="gemini-cli" onSelectHost={() => undefined} />);
    const screen = within(document.body);
    assert.ok(screen.getByText("experimental"));
    assert.ok(screen.getByText("Protocol-compatible, not yet release-tested."));
    const prompts = within(screen.getByRole("list", { name: "Host prompts to expect" }));
    assert.ok(prompts.getByText(/1\. Register the server with gemini mcp add/));
    assert.ok(prompts.getByText(/Approve the RateLoop OAuth consent screen/));
  } finally {
    cleanup();
    restoreDom();
  }
});

test("supported plugin hosts mention the existing plugin path without extra friction", async () => {
  const restoreDom = installTestDom();
  const { cleanup, render, within } = await import("@testing-library/react");
  const { AgentConnectionHostPicker } = await import("./AgentConnectionHostPicker");

  try {
    render(<AgentConnectionHostPicker selectedHostId="codex-desktop" onSelectHost={() => undefined} />);
    const screen = within(document.body);
    assert.ok(screen.getByText("supported"));
    assert.ok(screen.getByText("plugin://rateloop-workspace@rateloop"));
  } finally {
    cleanup();
    restoreDom();
  }
});
