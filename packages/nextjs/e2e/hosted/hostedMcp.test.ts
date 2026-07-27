import { parseOAuthCallback, sha256Commitment } from "./hostedMcp";
import assert from "node:assert/strict";
import test from "node:test";

test("hosted MCP hashes the exact UTF-8 reviewer material", () => {
  assert.equal(
    sha256Commitment("RateLoop ✓"),
    "sha256:b4ec4f8cfadaccbe596a6d0111d82cae9d11c68f01336a0f3953739aff399185",
  );
});

test("OAuth callbacks require the exact loopback route and state", () => {
  const redirect = "http://127.0.0.1:43871/oauth/callback";
  assert.equal(parseOAuthCallback(`${redirect}?code=secret-code&state=expected`, redirect, "expected"), "secret-code");
  assert.throws(
    () => parseOAuthCallback(`${redirect}?code=secret-code&state=wrong`, redirect, "expected"),
    /state did not match/u,
  );
  assert.throws(
    () => parseOAuthCallback("http://127.0.0.1:43871/different?code=secret-code&state=expected", redirect, "expected"),
    /did not match the registered loopback redirect/u,
  );
  assert.throws(
    () => parseOAuthCallback(`${redirect}?error=access_denied&state=expected`, redirect, "expected"),
    /did not contain an authorization code/u,
  );
});
