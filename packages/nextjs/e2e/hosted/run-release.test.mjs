import { hostedReleaseSteps, runHostedRelease } from "./run-release.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const SHA = "a".repeat(40);

function environment(overrides = {}) {
  return {
    E2E_BASE_URL: "https://rateloop-tokenless.vercel.app",
    E2E_EXPECTED_GIT_REF: "tokenless",
    E2E_EXPECTED_GIT_SHA: SHA,
    ...overrides,
  };
}

test("the release runner composes preflight, smoke, and core in fail-closed order", async () => {
  const calls = [];
  const summary = await runHostedRelease({
    environment: environment(),
    readGit: async args => (args[0] === "branch" ? "tokenless" : SHA),
    runStep: async step => calls.push(step),
    yarnCommand: "test-yarn",
  });

  assert.deepEqual(
    calls.map(call => call.label),
    ["Hosted preflight", "Hosted read-only smoke", "Hosted mutating core journey"],
  );
  assert.deepEqual(calls[0].args.slice(-1), ["core"]);
  assert.deepEqual(
    calls.slice(1).map(call => [call.command, call.args]),
    [
      ["test-yarn", ["e2e:hosted:smoke"]],
      ["test-yarn", ["e2e:hosted:core"]],
    ],
  );
  assert.ok(calls.every(call => call.env.E2E_CHECKOUT_SHA === SHA));
  assert.deepEqual(
    summary.steps,
    calls.map(call => call.label),
  );
});

test("the release runner stops at the first failed boundary", async () => {
  const calls = [];
  await assert.rejects(
    runHostedRelease({
      environment: environment(),
      readGit: async args => (args[0] === "branch" ? "tokenless" : SHA),
      runStep: async step => {
        calls.push(step.label);
        if (step.label === "Hosted read-only smoke") throw new Error("smoke failed");
      },
    }),
    /smoke failed/u,
  );
  assert.deepEqual(calls, ["Hosted preflight", "Hosted read-only smoke"]);
});

test("the release runner refuses another branch, ref, or deployed SHA", async () => {
  const run = (branch, env) =>
    runHostedRelease({
      environment: env,
      readGit: async args => (args[0] === "branch" ? branch : SHA),
      runStep: async () => assert.fail("No release step may run after a failed identity check."),
    });

  await assert.rejects(run("main", environment()), /tokenless branch/u);
  await assert.rejects(run("tokenless", environment({ E2E_EXPECTED_GIT_REF: "main" })), /exactly tokenless/u);
  await assert.rejects(run("tokenless", environment({ E2E_EXPECTED_GIT_SHA: "b".repeat(40) })), /must match/u);
});

test("step summaries never serialize the inherited environment", () => {
  const serialized = JSON.stringify(
    hostedReleaseSteps({
      checkoutSha: SHA,
      environment: environment({ TOKENLESS_E2E_RESEND_RECEIVING_API_KEY: "re_secret" }),
      yarnCommand: "test-yarn",
    }).map(step => step.label),
  );
  assert.doesNotMatch(serialized, /re_secret/u);
});
