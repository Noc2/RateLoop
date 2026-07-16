import { createPublicKey } from "node:crypto";

export type Ed25519PublicJwk = { kty: "OKP"; crv: "Ed25519"; x: string };

export function encodeEd25519SpkiDerBase64url(publicKeyJwk: Ed25519PublicJwk) {
  const publicKey = createPublicKey({ key: publicKeyJwk, format: "jwk" });
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Expected an Ed25519 public key.");
  return publicKey.export({ format: "der", type: "spki" }).toString("base64url");
}
