import {
  loadAgentConnectionHostChoice,
  saveAgentConnectionHostChoice,
  tokenlessSupportTierMeaning,
} from "./AgentConnectionHostPicker";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TOKENLESS_HOST_SUPPORT_TIERS } from "~~/lib/tokenless/hostCapabilities";

const source = readFileSync(new URL("./AgentConnectionHostPicker.tsx", import.meta.url), "utf8");

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

test("the picker is one optional disclosure with registry-driven, keyboard-reachable chips", () => {
  assert.match(source, /<details/);
  assert.match(source, /<summary[^>]*>\s*Connecting to a specific tool\?/);
  assert.match(source, /TOKENLESS_HOST_CAPABILITIES\.map\(host =>/);
  assert.match(source, /aria-pressed=\{selected\}/);
  assert.match(source, /role="group" aria-label="Agent host"/);
  assert.match(source, /onSelectHost\(selected \? null : host\.id\)/);
  // No chip is required and no host is invented outside the registry.
  assert.doesNotMatch(source, /required/i);
});

test("selected hosts show the tier badge, expected prompts, and only factual affordances", () => {
  assert.match(source, /tokenlessSupportTierMeaning\(host\.supportTier\)/);
  assert.match(source, /aria-label="Host prompts to expect"/);
  assert.match(source, /host\.humanActions\.map/);
  assert.match(source, /host\.installAffordances\.map/);
  // cli-command and config-snippet render as copyable code; settings and plugin refs stay text.
  assert.match(source, /\{copied \? "Copied" : "Copy"\}/);
  assert.match(source, /affordance\.kind === "settings-instructions"/);
  assert.match(source, /affordance\.kind === "plugin-marketplace"/);
  // Unverified install deep links are never rendered.
  assert.match(source, /affordance\.kind === "deep-link"\) return null/);
});

test("every support tier has one honest meaning line", () => {
  for (const tier of TOKENLESS_HOST_SUPPORT_TIERS) {
    assert.ok(tokenlessSupportTierMeaning(tier).length > 0, tier);
  }
  assert.equal(tokenlessSupportTierMeaning("experimental"), "Protocol-compatible, not yet release-tested.");
  assert.match(tokenlessSupportTierMeaning("supported"), /plugin/i);
  assert.match(tokenlessSupportTierMeaning("verified"), /pinned client version/);
});

test("the host choice is remembered per workspace and validated against the registry", () => {
  const storage = memoryStorage();
  saveAgentConnectionHostChoice("ws_1", "claude-code", storage);
  assert.equal(loadAgentConnectionHostChoice("ws_1", storage), "claude-code");
  assert.equal(loadAgentConnectionHostChoice("ws_2", storage), null);
  assert.equal(storage.getItem("rateloop:agent-host-choice:v1:ws_1"), "claude-code");

  saveAgentConnectionHostChoice("ws_1", null, storage);
  assert.equal(loadAgentConnectionHostChoice("ws_1", storage), null);
  assert.equal(storage.length, 0);
});

test("stale or unknown stored hosts are discarded instead of guessed", () => {
  const storage = memoryStorage();
  storage.setItem("rateloop:agent-host-choice:v1:ws_1", "retired-host");
  assert.equal(loadAgentConnectionHostChoice("ws_1", storage), null);
  assert.equal(storage.length, 0);
});

test("storage failures never block sharing the universal message", () => {
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  } as unknown as Storage;
  assert.equal(loadAgentConnectionHostChoice("ws_1", broken), null);
  assert.doesNotThrow(() => saveAgentConnectionHostChoice("ws_1", "claude-code", broken));
  assert.equal(loadAgentConnectionHostChoice("ws_1", null), null);
  assert.doesNotThrow(() => saveAgentConnectionHostChoice("ws_1", "claude-code", null));
});
