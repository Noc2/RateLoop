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

test("only the bundled plugin marketplace affordances exist until others are verified", () => {
  const hostsWithAffordances = HOSTS.filter(host => host.installAffordances.length > 0);
  assert.deepEqual(hostsWithAffordances.map(host => host.id).sort(), ["claude-code", "codex-desktop"]);
  for (const host of hostsWithAffordances) {
    assert.deepEqual(
      host.installAffordances.map(affordance => [affordance.kind, affordance.value]),
      [["plugin-marketplace", "plugin://rateloop-workspace@rateloop"]],
    );
  }
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
