import { createPublicKey } from "node:crypto";
import { type Hex, toHex } from "viem";

const CURVE_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;

function readDerLength(bytes: Uint8Array, cursor: number) {
  const first = bytes[cursor];
  if (first === undefined) throw new Error("DER length is truncated.");
  if ((first & 0x80) === 0) return { cursor: cursor + 1, length: first };
  const octets = first & 0x7f;
  if (octets === 0 || octets > 2 || cursor + octets >= bytes.length) throw new Error("DER length is invalid.");
  if (bytes[cursor + 1] === 0) throw new Error("DER length is not canonical.");
  let length = 0;
  for (let index = 0; index < octets; index += 1) length = length * 256 + bytes[cursor + 1 + index]!;
  if (length < 128) throw new Error("DER length is not canonical.");
  return { cursor: cursor + 1 + octets, length };
}

function readDerInteger(bytes: Uint8Array, cursor: number) {
  if (bytes[cursor] !== 0x02) throw new Error("DER signature integer is missing.");
  const encodedLength = readDerLength(bytes, cursor + 1);
  const end = encodedLength.cursor + encodedLength.length;
  if (encodedLength.length === 0 || end > bytes.length) throw new Error("DER signature integer is invalid.");

  let start = encodedLength.cursor;
  if (bytes[start] === 0) {
    if (encodedLength.length > 1 && (bytes[start + 1]! & 0x80) === 0) {
      throw new Error("DER signature integer is not canonical.");
    }
    start += 1;
  } else if ((bytes[start]! & 0x80) !== 0) {
    throw new Error("DER signature integer is negative.");
  }
  if (end - start > 32 || start === end) throw new Error("DER signature integer is out of range.");
  const hex = Buffer.from(bytes.slice(start, end)).toString("hex").padStart(64, "0");
  return { cursor: end, value: BigInt(`0x${hex}`) };
}

export function parseAwsKmsDerSignature(bytes: Uint8Array) {
  if (bytes[0] !== 0x30) throw new Error("KMS signature is not a DER sequence.");
  const sequence = readDerLength(bytes, 1);
  if (sequence.cursor + sequence.length !== bytes.length) throw new Error("KMS signature sequence is invalid.");
  const r = readDerInteger(bytes, sequence.cursor);
  const s = readDerInteger(bytes, r.cursor);
  if (s.cursor !== bytes.length || r.value <= 0n || r.value >= CURVE_ORDER || s.value <= 0n || s.value >= CURVE_ORDER) {
    throw new Error("KMS signature scalar is invalid.");
  }
  return { r: r.value, s: s.value > HALF_CURVE_ORDER ? CURVE_ORDER - s.value : s.value };
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

export function parseAwsKmsSecp256k1PublicKey(spki: Uint8Array): Hex {
  let publicKey;
  try {
    publicKey = createPublicKey({ format: "der", key: Buffer.from(spki), type: "spki" });
  } catch (error) {
    throw new Error("KMS public key is not valid SPKI.", { cause: error });
  }
  const canonicalSpki = publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.from(spki).equals(canonicalSpki)) throw new Error("KMS public key SPKI is not canonical.");
  if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "secp256k1") {
    throw new Error("KMS public key is not secp256k1.");
  }
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y || jwk.crv !== "secp256k1") throw new Error("KMS public key coordinates are unavailable.");
  const x = decodeBase64Url(jwk.x);
  const y = decodeBase64Url(jwk.y);
  if (x.length !== 32 || y.length !== 32) throw new Error("KMS public key coordinates are invalid.");
  return toHex(Buffer.concat([Buffer.from([0x04]), x, y]));
}

export const __awsKmsSecp256k1TestUtils = { CURVE_ORDER, HALF_CURVE_ORDER };
