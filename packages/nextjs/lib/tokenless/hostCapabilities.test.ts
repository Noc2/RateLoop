import {
  TOKENLESS_CONNECTION_LANES,
  TOKENLESS_HOST_CAPABILITIES,
  TOKENLESS_HOST_CATEGORIES,
  TOKENLESS_HOST_MESSAGE_VARIANTS,
  TOKENLESS_HOST_SUPPORT_TIERS,
  TOKENLESS_INSTALL_AFFORDANCE_KINDS,
  type TokenlessHostCapability,
  tokenlessHostCapability,
  tokenlessHostMessageVariant,
} from "./hostCapabilities";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOSTS: readonly TokenlessHostCapability[] = TOKENLESS_HOST_CAPABILITIES;

test("verified tier requires evidence and no host is verified today", () => {
  for (const host of HOSTS) {
    const isVerified = host.supportTier === "verified";
    assert.equal(
      host.verifiedAt !== undefined && host.verificationEvidence !== undefined,
      isVerified,
      `${host.id} must carry verifiedAt and verificationEvidence exactly when verified`,
    );
    if (isVerified) {
      assert.match(host.verifiedAt, ISO_DATE_RE);
      assert.ok(host.verificationEvidence.length > 0);
    }
  }

  // No pinned-version smoke run exists yet, so nothing may claim the tier.
  assert.equal(HOSTS.filter(host => host.supportTier === "verified").length, 0);
});

test("every install affordance carries its own freshness evidence", () => {
  for (const host of HOSTS) {
    for (const affordance of host.installAffordances) {
      assert.ok(TOKENLESS_INSTALL_AFFORDANCE_KINDS.includes(affordance.kind), `${host.id} affordance kind`);
      assert.ok(affordance.label.length > 0, `${host.id} affordance label`);
      assert.ok(affordance.value.length > 0, `${host.id} affordance value`);
      assert.match(affordance.checkedAt, ISO_DATE_RE, `${host.id} affordance checkedAt`);
      assert.ok(affordance.clientVersion.length > 0, `${host.id} affordance clientVersion`);
    }
  }
});

test("install affordances exist only where repo-documented syntax exists", () => {
  assert.deepEqual(
    HOSTS.filter(host => host.installAffordances.length > 0)
      .map(host => host.id)
      .sort(),
    [
      "chatgpt-connectors",
      "claude-code",
      "claude-desktop",
      "codex-desktop",
      "gemini-cli",
      "headless-sdk",
      "vscode-copilot-chat",
    ],
  );
  // Cursor and the generic fallback stay affordance-free until verified syntax exists.
  assert.deepEqual(tokenlessHostCapability("cursor")?.installAffordances, []);
  assert.deepEqual(tokenlessHostCapability("generic-mcp")?.installAffordances, []);
});

test("plugin hosts keep the bundled marketplace path as the primary affordance", () => {
  for (const id of ["codex-desktop", "claude-code"]) {
    const host = tokenlessHostCapability(id);
    assert.ok(host, id);
    assert.equal(host.installAffordances[0].kind, "plugin-marketplace");
    assert.equal(host.installAffordances[0].value, "plugin://rateloop-workspace@rateloop");
  }
});

test("every cli-command targets the isolated tokenless deployment and no deep link is published", () => {
  for (const host of HOSTS) {
    for (const affordance of host.installAffordances) {
      assert.notEqual(affordance.kind, "deep-link", `${host.id} must not publish install deep links`);
      if (affordance.kind === "cli-command") {
        assert.ok(
          affordance.value.includes("rateloop-tokenless.vercel.app"),
          `${host.id} cli-command must name the real server host`,
        );
      }
      if (affordance.checkedAt !== "2026-07-17") {
        assert.fail(`${host.id} affordance checkedAt must match the compatibility-review check date`);
      }
    }
  }
});

test("documented per-host shapes match the published connect guide verbatim", () => {
  const guide = readFileSync(new URL("../../public/docs/agent-connection.md", import.meta.url), "utf8");
  const claudeCli = tokenlessHostCapability("claude-code")?.installAffordances.find(a => a.kind === "cli-command");
  assert.ok(claudeCli);
  assert.equal(
    claudeCli.value,
    "claude mcp add --scope user --transport http rateloop-workspace https://rateloop-tokenless.vercel.app/api/agent/v1/mcp",
  );
  assert.ok(guide.includes(claudeCli.value), "claude-code cli-command must appear in the guide");

  const vscode = tokenlessHostCapability("vscode-copilot-chat")?.installAffordances.find(
    a => a.kind === "config-snippet",
  );
  assert.ok(vscode);
  assert.ok(vscode.value.includes('"servers"') && !vscode.value.includes("mcpServers"), "vscode uses servers");
  assert.match(vscode.label, /oauth\.clientId/);
  assert.ok(guide.includes(vscode.value), "vscode config-snippet must appear in the guide");

  const gemini = tokenlessHostCapability("gemini-cli");
  const geminiCli = gemini?.installAffordances.find(a => a.kind === "cli-command");
  const geminiSnippet = gemini?.installAffordances.find(a => a.kind === "config-snippet");
  assert.ok(geminiCli && geminiSnippet);
  assert.ok(geminiCli.value.includes("--transport http"));
  assert.ok(geminiSnippet.value.includes('"httpUrl"') && !geminiSnippet.value.includes('"url"'), "gemini uses httpUrl");
  assert.ok(guide.includes(geminiCli.value), "gemini cli-command must appear in the guide");
  assert.ok(guide.includes(geminiSnippet.value), "gemini config-snippet must appear in the guide");
});

test("settings-only and headless affordances stay short, honest, and sourced", () => {
  for (const id of ["claude-desktop", "chatgpt-connectors"]) {
    const host = tokenlessHostCapability(id);
    assert.ok(host, id);
    assert.deepEqual(
      host.installAffordances.map(affordance => affordance.kind),
      ["settings-instructions"],
    );
    assert.match(host.installAffordances[0].value, /settings/);
    assert.ok(host.installAffordances[0].value.includes("/docs/connect"), `${id} points at the connect docs`);
  }

  const headless = tokenlessHostCapability("headless-sdk")?.installAffordances.find(a => a.kind === "cli-command");
  assert.ok(headless);
  assert.ok(headless.value.includes("rateloop-agents"), "headless uses the published bin name");
  assert.ok(headless.value.includes("RATELOOP_AGENT_API_KEY"), "headless names the workspace key env var");
  assert.equal(headless.clientVersion, "@rateloop/agents@0.2.0");
});

test("host ids are unique and kebab-case", () => {
  const ids = HOSTS.map(host => host.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, KEBAB_CASE_RE);
  }
});

test("every host declares valid category, tier, lanes, actions, and variant", () => {
  for (const host of HOSTS) {
    assert.ok(host.displayName.length > 0, `${host.id} displayName`);
    assert.ok(TOKENLESS_HOST_CATEGORIES.includes(host.category), `${host.id} category`);
    assert.ok(TOKENLESS_HOST_SUPPORT_TIERS.includes(host.supportTier), `${host.id} supportTier`);
    assert.ok(TOKENLESS_HOST_MESSAGE_VARIANTS.includes(host.messageVariant), `${host.id} messageVariant`);

    assert.ok(host.lanes.length >= 1, `${host.id} needs at least one lane`);
    assert.equal(new Set(host.lanes).size, host.lanes.length, `${host.id} lanes must not repeat`);
    for (const lane of host.lanes) {
      assert.ok(TOKENLESS_CONNECTION_LANES.includes(lane), `${host.id} lane ${lane}`);
    }

    assert.ok(host.humanActions.length >= 1 && host.humanActions.length <= 3, `${host.id} needs 1-3 human actions`);
    for (const action of host.humanActions) {
      assert.ok(action.length > 0, `${host.id} human action`);
    }
  }
});

test("the plugin lanes and variants stay honest per host category", () => {
  for (const host of HOSTS) {
    const hasPluginLane = host.lanes.includes("plugin-with-hooks");
    assert.equal(hasPluginLane, host.category === "plugin-host", `${host.id} plugin lane`);
    assert.equal(host.messageVariant === "plugin", host.category === "plugin-host", `${host.id} plugin variant`);
    if (host.supportTier === "supported") {
      assert.equal(host.category, "plugin-host", `${host.id} only bundled plugin paths are supported today`);
    }
  }
});

test("the universal generic-mcp fallback exists and lookup helpers resolve it", () => {
  const fallback = tokenlessHostCapability("generic-mcp");
  assert.ok(fallback);
  assert.equal(fallback.messageVariant, "generic-mcp");
  assert.equal(tokenlessHostMessageVariant("generic-mcp"), "generic-mcp");
  assert.equal(tokenlessHostCapability("unknown-host"), undefined);
  assert.equal(tokenlessHostMessageVariant("unknown-host"), undefined);
});
