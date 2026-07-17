import { type ReviewConfigurationSaveDeps, saveReviewConfigurationAndAdvance } from "./reviewConfigurationSave";
import assert from "node:assert/strict";
import test from "node:test";

/**
 * A harness that models the server's binding version and the browser's locally adopted version.
 * The PUT advances the server binding and returns the new version; the wizard advance and the
 * authoritative reload read the server binding. This lets the tests assert that a retry after a
 * partial failure sends the current expectedBindingVersion and succeeds without a full reload.
 */
function harness(options: {
  startVersion: number;
  putBehavior: () => "ok" | "advance_lost" | "advance_and_response_lost";
  advanceBehavior: () => "ok" | "fail";
}) {
  const state = { serverBindingVersion: options.startVersion, adoptedVersion: options.startVersion };
  const sentExpectedVersions: number[] = [];
  const advancedWithVersions: number[] = [];

  const deps: ReviewConfigurationSaveDeps = {
    putHumanReviewConfiguration: async () => {
      sentExpectedVersions.push(state.adoptedVersion);
      if (state.adoptedVersion !== state.serverBindingVersion) {
        // Mirrors the server 409 for a stale expectedBindingVersion.
        throw new Error("human_review_configuration_conflict");
      }
      const behavior = options.putBehavior();
      // The server commits and advances the binding on every accepted PUT.
      state.serverBindingVersion += 1;
      if (behavior === "advance_and_response_lost") throw new Error("network response lost");
      return { bindingRevision: state.serverBindingVersion };
    },
    advanceSetup: async bindingRevision => {
      advancedWithVersions.push(bindingRevision);
      if (options.advanceBehavior() === "fail") throw new Error("configure-reviews failed");
    },
    reloadAuthoritativeBindingRevision: async () => state.serverBindingVersion,
    adoptBindingRevision: bindingRevision => {
      state.adoptedVersion = bindingRevision;
    },
  };

  return { state, deps, sentExpectedVersions, advancedWithVersions };
}

test("the happy path saves, advances with the new version, and adopts it", async () => {
  const h = harness({ startVersion: 3, putBehavior: () => "ok", advanceBehavior: () => "ok" });
  await saveReviewConfigurationAndAdvance(h.deps);
  assert.deepEqual(h.sentExpectedVersions, [3]);
  assert.deepEqual(h.advancedWithVersions, [4]);
  assert.equal(h.state.adoptedVersion, 4);
});

test("a failed advance is retryable without a reload: retry uses the adopted binding and succeeds", async () => {
  let advanceCalls = 0;
  const h = harness({
    startVersion: 3,
    putBehavior: () => "ok",
    advanceBehavior: () => (++advanceCalls === 1 ? "fail" : "ok"),
  });

  // First attempt: PUT commits (server -> 4) and is adopted, but the wizard advance fails.
  await assert.rejects(saveReviewConfigurationAndAdvance(h.deps), /configure-reviews failed/);
  assert.equal(h.state.adoptedVersion, 4);

  // Retry: it must send the adopted version 4 (not the stale 3) so the server does not 409.
  await saveReviewConfigurationAndAdvance(h.deps);
  assert.deepEqual(h.sentExpectedVersions, [3, 4]);
  assert.equal(h.state.adoptedVersion, 5);
  assert.equal(advanceCalls, 2);
});

test("a lost save response is retryable: the catch reloads the authoritative binding before retry", async () => {
  let putCalls = 0;
  const h = harness({
    startVersion: 7,
    // First PUT commits server-side (7 -> 8) but the response is lost, so the client never adopts 8.
    putBehavior: () => (++putCalls === 1 ? "advance_and_response_lost" : "ok"),
    advanceBehavior: () => "ok",
  });

  await assert.rejects(saveReviewConfigurationAndAdvance(h.deps), /network response lost/);
  // The catch must reload the authoritative version and adopt it so the stale 7 is not reused.
  assert.equal(h.state.adoptedVersion, 8);

  await saveReviewConfigurationAndAdvance(h.deps);
  assert.deepEqual(h.sentExpectedVersions, [7, 8]);
  assert.equal(h.state.adoptedVersion, 9);
});

test("resending the original stale binding version would 409 without the adoption fix", async () => {
  // Guards the regression directly: if the client kept the stale version, the retry PUT conflicts.
  const h = harness({ startVersion: 2, putBehavior: () => "ok", advanceBehavior: () => "fail" });
  await assert.rejects(saveReviewConfigurationAndAdvance(h.deps), /configure-reviews failed/);
  // Simulate the old buggy behavior: revert the adopted version to the stale original.
  h.deps.adoptBindingRevision(2);
  await assert.rejects(saveReviewConfigurationAndAdvance(h.deps), /human_review_configuration_conflict/);
});

test("an invalid saved binding version is treated as a failure and reloads the authoritative version", async () => {
  const state = { adopted: 5 };
  const deps: ReviewConfigurationSaveDeps = {
    putHumanReviewConfiguration: async () => ({ bindingRevision: Number.NaN }),
    advanceSetup: async () => undefined,
    reloadAuthoritativeBindingRevision: async () => 6,
    adoptBindingRevision: bindingRevision => {
      state.adopted = bindingRevision;
    },
  };
  await assert.rejects(saveReviewConfigurationAndAdvance(deps), /could not be confirmed/);
  assert.equal(state.adopted, 6);
});
