import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("wallet JWKS route is public, short-cached, and exposes no private issuer material", () => {
  const source = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
  assert.match(source, /thirdwebWalletJwks/);
  assert.match(source, /public, max-age=300/);
  assert.doesNotMatch(source, /PRIVATE_JWK|privateJwk/);
});
