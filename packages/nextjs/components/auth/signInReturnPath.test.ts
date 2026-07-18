import { normalizeSignInReturnPath } from "./signInReturnPath";
import assert from "node:assert/strict";
import test from "node:test";

const ORIGIN = "https://rateloop-tokenless.vercel.app";

test("sign-in return paths preserve only normalized same-origin paths", () => {
  assert.equal(normalizeSignInReturnPath("/agents?tab=overview#connected", ORIGIN), "/agents?tab=overview#connected");
  assert.equal(normalizeSignInReturnPath("/settings/wallets", ORIGIN), "/settings/wallets");
  assert.equal(normalizeSignInReturnPath(null, ORIGIN), "/agents");
  assert.equal(normalizeSignInReturnPath("https://evil.example/phish", ORIGIN), "/agents");
  assert.equal(normalizeSignInReturnPath("//evil.example/phish", ORIGIN), "/agents");
});

test("sign-in return paths reject encoded and mixed backslash redirects", () => {
  const encoded = new URL(`${ORIGIN}/sign-in?returnTo=/%5Cevil.example`).searchParams.get("returnTo");
  assert.equal(encoded, "/\\evil.example");
  assert.equal(normalizeSignInReturnPath(encoded, ORIGIN), "/agents");
  assert.equal(normalizeSignInReturnPath("/\\/evil.example", ORIGIN), "/agents");
  assert.equal(normalizeSignInReturnPath("/safe\\..\\evil.example", ORIGIN), "/agents");
  assert.equal(normalizeSignInReturnPath("/safe\nlocation", ORIGIN), "/agents");
});
