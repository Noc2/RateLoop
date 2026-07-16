import { type Ed25519PublicJwk, encodeEd25519SpkiDerBase64url } from "./evidenceVerificationKey";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

test("workspace verification keys are projected as SPKI DER base64url", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as Ed25519PublicJwk;

  assert.equal(
    encodeEd25519SpkiDerBase64url(jwk),
    publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  );
});

test("the projection rejects a public key with another algorithm", () => {
  const { publicKey } = generateKeyPairSync("x25519");
  const jwk = publicKey.export({ format: "jwk" }) as Ed25519PublicJwk;
  assert.throws(() => encodeEd25519SpkiDerBase64url(jwk), /Ed25519/);
});
