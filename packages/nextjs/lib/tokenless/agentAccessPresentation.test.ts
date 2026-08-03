import {
  deriveAgentAccessPresentation,
  hasActiveAgentAccess,
  normalizeAgentAccessPresentation,
} from "./agentAccessPresentation";
import assert from "node:assert/strict";
import test from "node:test";

const NOW = Date.parse("2026-08-03T12:00:00.000Z");
const FUTURE = "2026-08-03T13:00:00.000Z";

function oauth(overrides: Record<string, unknown> = {}) {
  return {
    activationMode: "preauthorized_safe",
    integrationStatus: "active",
    connectionStatus: "connected",
    credentialExpiresAt: FUTURE,
    tokenFamilyStatus: "active",
    oauthRecoveryAvailable: false,
    grantedScopes: ["quote:read", "result:read"],
    ...overrides,
  };
}

test("effective access is derived from credential, lifecycle, expiry, and stored grants together", () => {
  const safe = deriveAgentAccessPresentation(oauth(), NOW);
  assert.deepEqual(safe, {
    credentialKind: "oauth",
    rateLoopAccessState: "active",
    hostToolReadiness: "unverified",
    canPublish: false,
    canSpend: false,
  });

  const publishing = deriveAgentAccessPresentation(
    oauth({ activationMode: "owner_approved", grantedScopes: ["panel:publish"] }),
    NOW,
  );
  assert.equal(publishing.canPublish, true);
  assert.equal(publishing.canSpend, false);

  const paid = deriveAgentAccessPresentation(
    oauth({ activationMode: "owner_approved", grantedScopes: ["panel:publish", "payment:submit"] }),
    NOW,
  );
  assert.equal(paid.canPublish, true);
  assert.equal(paid.canSpend, true);
});

test("replay recovery, revocation, and the expiry boundary all fail closed", () => {
  const recovery = deriveAgentAccessPresentation(
    oauth({ oauthRecoveryAvailable: true, tokenFamilyStatus: "revoked" }),
    NOW,
  );
  assert.equal(recovery.rateLoopAccessState, "recovery_required");
  assert.equal(recovery.canPublish, false);
  assert.equal(recovery.canSpend, false);
  assert.equal(hasActiveAgentAccess(recovery), false);

  for (const access of [
    deriveAgentAccessPresentation(oauth({ tokenFamilyStatus: "revoked" }), NOW),
    deriveAgentAccessPresentation(oauth({ integrationStatus: "revoked" }), NOW),
    deriveAgentAccessPresentation(oauth({ credentialExpiresAt: new Date(NOW).toISOString() }), NOW),
  ]) {
    assert.equal(access.rateLoopAccessState, "inactive");
    assert.equal(hasActiveAgentAccess(access), false);
  }
});

test("legacy access permits its retired null intent state but still requires an active unexpired credential", () => {
  const legacy = deriveAgentAccessPresentation(
    oauth({
      activationMode: "legacy_pairing",
      connectionStatus: null,
      tokenFamilyStatus: null,
      grantedScopes: ["panel:publish"],
    }),
    NOW,
  );
  assert.equal(legacy.credentialKind, "legacy");
  assert.equal(legacy.rateLoopAccessState, "active");
  assert.equal(legacy.canPublish, true);

  assert.equal(
    deriveAgentAccessPresentation(
      oauth({ activationMode: "legacy_pairing", credentialExpiresAt: null, tokenFamilyStatus: null }),
      NOW,
    ).rateLoopAccessState,
    "inactive",
  );
});

test("unknown and serialized malformed presentations normalize to inactive access", () => {
  const unknown = deriveAgentAccessPresentation(oauth({ activationMode: "future_mode" }), NOW);
  assert.deepEqual(unknown, {
    credentialKind: "unknown",
    rateLoopAccessState: "inactive",
    hostToolReadiness: "unverified",
    canPublish: false,
    canSpend: false,
  });
  assert.deepEqual(normalizeAgentAccessPresentation({ rateLoopAccessState: "active", canSpend: true }), unknown);

  const paid = deriveAgentAccessPresentation(
    oauth({ activationMode: "owner_approved", grantedScopes: ["panel:publish", "payment:submit"] }),
    NOW,
  );
  const roundTrip = normalizeAgentAccessPresentation(JSON.parse(JSON.stringify(paid)));
  assert.deepEqual(roundTrip, paid);
  assert.equal(hasActiveAgentAccess(roundTrip), true);
});
