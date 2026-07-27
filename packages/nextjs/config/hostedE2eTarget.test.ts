import { hostedE2eTarget } from "./hostedE2eTarget";
import assert from "node:assert/strict";
import test from "node:test";

const SHA = "c".repeat(40);

test("hosted E2E accepts the canonical tokenless origin with an exact expected SHA", () => {
  assert.deepEqual(
    hostedE2eTarget({
      E2E_BASE_URL: "https://rateloop-tokenless.vercel.app",
      E2E_EXPECTED_GIT_SHA: SHA,
    }),
    {
      baseURL: "https://rateloop-tokenless.vercel.app",
      expectedGitRef: "tokenless",
      expectedGitSha: SHA,
      kind: "canonical",
    },
  );
});

test("hosted E2E accepts only the explicitly named immutable tokenless host", () => {
  const host = "rateloop-tokenless-a1b2c3d4e-rateloop.vercel.app";
  assert.deepEqual(
    hostedE2eTarget({
      E2E_ALLOWED_IMMUTABLE_HOST: host,
      E2E_BASE_URL: `https://${host}`,
      E2E_EXPECTED_GIT_REF: "tokenless",
      E2E_EXPECTED_GIT_SHA: SHA,
    }),
    {
      baseURL: `https://${host}`,
      expectedGitRef: "tokenless",
      expectedGitSha: SHA,
      kind: "immutable",
    },
  );
  assert.throws(
    () =>
      hostedE2eTarget({
        E2E_BASE_URL: `https://${host}`,
        E2E_EXPECTED_GIT_SHA: SHA,
      }),
    /explicit tokenless allowlist/u,
  );
});

test("hosted E2E refuses legacy, unknown, branch-alias, and malformed targets", () => {
  for (const environment of [
    { E2E_BASE_URL: "https://rateloop.ai", E2E_EXPECTED_GIT_SHA: SHA },
    { E2E_BASE_URL: "https://www.rateloop.ai", E2E_EXPECTED_GIT_SHA: SHA },
    { E2E_BASE_URL: "https://example.com", E2E_EXPECTED_GIT_SHA: SHA },
    { E2E_BASE_URL: "http://rateloop-tokenless.vercel.app", E2E_EXPECTED_GIT_SHA: SHA },
    { E2E_BASE_URL: "https://rateloop-tokenless.vercel.app:8443", E2E_EXPECTED_GIT_SHA: SHA },
    { E2E_BASE_URL: "https://rateloop-tokenless.vercel.app/rate", E2E_EXPECTED_GIT_SHA: SHA },
    { E2E_BASE_URL: "https://user:password@rateloop-tokenless.vercel.app", E2E_EXPECTED_GIT_SHA: SHA },
    {
      E2E_ALLOWED_IMMUTABLE_HOST: "rateloop-tokenless-git-tokenless-rateloop.vercel.app",
      E2E_BASE_URL: "https://rateloop-tokenless-git-tokenless-rateloop.vercel.app",
      E2E_EXPECTED_GIT_SHA: SHA,
    },
  ]) {
    assert.throws(() => hostedE2eTarget(environment), /Hosted E2E|E2E_ALLOWED/u);
  }
});

test("hosted E2E requires the full expected SHA and tokenless ref", () => {
  assert.throws(
    () =>
      hostedE2eTarget({
        E2E_BASE_URL: "https://rateloop-tokenless.vercel.app",
        E2E_EXPECTED_GIT_SHA: "short",
      }),
    /full lowercase 40-character commit SHA/u,
  );
  assert.throws(
    () =>
      hostedE2eTarget({
        E2E_BASE_URL: "https://rateloop-tokenless.vercel.app",
        E2E_EXPECTED_GIT_REF: "main",
        E2E_EXPECTED_GIT_SHA: SHA,
      }),
    /only the tokenless Git ref/u,
  );
});
