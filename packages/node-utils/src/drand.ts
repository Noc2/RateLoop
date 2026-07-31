import { bls12_381 } from "@noble/curves/bls12-381";
import { sha256 } from "@noble/hashes/sha256";

const UTF8 = new TextEncoder();
const MAX_UINT64 = (1n << 64n) - 1n;

export const REFERENCE_SAMPLE_SEED_DOMAIN = "rateloop-reference-sample-seed-v1";

export type DrandSchemeId =
  | "pedersen-bls-chained"
  | "pedersen-bls-unchained"
  | "bls-unchained-on-g1"
  | "bls-unchained-g1-rfc9380";

export interface PinnedDrandChain {
  readonly networkId: string;
  readonly chainHash: string;
  readonly publicKey: string;
  readonly schemeId: DrandSchemeId;
  readonly genesisTime: number;
  readonly period: number;
  readonly groupHash: string;
  readonly beaconId: string;
}

export interface DrandChainInfo {
  readonly public_key: string;
  readonly period: number;
  readonly genesis_time: number;
  readonly hash: string;
  readonly groupHash: string;
  readonly schemeID: string;
  readonly metadata: { readonly beaconID: string };
}

export interface DrandBeaconEvidence {
  readonly round: number;
  readonly randomness: string;
  readonly signature: string;
  readonly previous_signature?: string;
}

export interface VerifiedDrandBeaconEvidence {
  readonly chain: PinnedDrandChain;
  readonly round: number;
  readonly randomness: `0x${string}`;
  readonly signature: `0x${string}`;
  readonly previousSignature?: `0x${string}`;
}

export const PINNED_DRAND_CHAINS = {
  quicknet: {
    networkId: "quicknet",
    chainHash:
      "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    publicKey:
      "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
    schemeId: "bls-unchained-g1-rfc9380",
    genesisTime: 1_692_803_367,
    period: 3,
    groupHash:
      "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
    beaconId: "quicknet",
  },
  "quicknet-t": {
    networkId: "quicknet-t",
    chainHash:
      "cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5",
    publicKey:
      "b15b65b46fb29104f6a4b5d1e11a8da6344463973d423661bb0804846a0ecd1ef93c25057f1c0baab2ac53e56c662b66072f6d84ee791a3382bfb055afab1e6a375538d8ffc451104ac971d2dc9b168e2d3246b0be2015969cbaac298f6502da",
    schemeId: "bls-unchained-g1-rfc9380",
    genesisTime: 1_689_232_296,
    period: 3,
    groupHash:
      "40d49d910472d4adb1d67f65db8332f11b4284eecf05c05c5eacd5eef7d40e2d",
    beaconId: "quicknet-t",
  },
} as const satisfies Record<string, PinnedDrandChain>;

export type PinnedDrandNetwork = keyof typeof PINNED_DRAND_CHAINS;

export class DrandVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrandVerificationError";
  }
}

function normalizeHex(value: string, bytes: number, label: string) {
  if (typeof value !== "string") {
    throw new DrandVerificationError(`${label} is not ${bytes} bytes.`);
  }
  const normalized = value.toLowerCase().replace(/^0x/u, "");
  if (!new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "u").test(normalized)) {
    throw new DrandVerificationError(`${label} is not ${bytes} bytes.`);
  }
  return normalized;
}

function hexBytes(value: string) {
  const normalized = value.replace(/^0x/u, "");
  return Uint8Array.from(normalized.match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function equalHex(left: string, right: string, bytes: number) {
  return (
    normalizeHex(left, bytes, "drand chain field") ===
    normalizeHex(right, bytes, "pinned drand chain field")
  );
}

export function assertPinnedDrandChainInfo(
  chain: PinnedDrandChain,
  actual: DrandChainInfo,
) {
  const publicKeyBytes =
    chain.schemeId === "pedersen-bls-chained" ||
    chain.schemeId === "pedersen-bls-unchained"
      ? 48
      : 96;
  if (
    !equalHex(actual.hash, chain.chainHash, 32) ||
    !equalHex(actual.public_key, chain.publicKey, publicKeyBytes) ||
    actual.schemeID !== chain.schemeId ||
    actual.genesis_time !== chain.genesisTime ||
    actual.period !== chain.period ||
    !equalHex(actual.groupHash, chain.groupHash, 32) ||
    actual.metadata?.beaconID !== chain.beaconId
  ) {
    throw new DrandVerificationError(
      `Drand chain info does not match pinned network ${chain.networkId}.`,
    );
  }
}

function uint64(value: bigint, label: string) {
  if (value < 0n || value > MAX_UINT64) {
    throw new DrandVerificationError(`${label} is outside uint64.`);
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function concat(...values: readonly Uint8Array[]) {
  const output = new Uint8Array(
    values.reduce((length, value) => length + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function signatureLengths(schemeId: DrandSchemeId) {
  return schemeId === "pedersen-bls-chained" ||
    schemeId === "pedersen-bls-unchained"
    ? { publicKey: 48, signature: 96 }
    : { publicKey: 96, signature: 48 };
}

function assertEvidenceShape(
  chain: PinnedDrandChain,
  beacon: DrandBeaconEvidence,
  expectedRound: number,
) {
  if (
    !Number.isSafeInteger(expectedRound) ||
    expectedRound <= 0 ||
    beacon.round !== expectedRound
  ) {
    throw new DrandVerificationError(
      "Drand beacon round does not match the frozen round.",
    );
  }
  const lengths = signatureLengths(chain.schemeId);
  const randomness = normalizeHex(beacon.randomness, 32, "Drand randomness");
  const signature = normalizeHex(
    beacon.signature,
    lengths.signature,
    "Drand signature",
  );
  const chained = chain.schemeId === "pedersen-bls-chained";
  if (chained && beacon.previous_signature === undefined) {
    throw new DrandVerificationError(
      "A chained drand beacon is missing its previous signature.",
    );
  }
  if (!chained && beacon.previous_signature !== undefined) {
    throw new DrandVerificationError(
      "An unchained drand beacon must not carry a previous signature.",
    );
  }
  const previousSignature = chained
    ? normalizeHex(
        beacon.previous_signature!,
        lengths.signature,
        "Previous drand signature",
      )
    : undefined;
  return { randomness, signature, previousSignature, lengths };
}

function verifyG1Signature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
  domainSeparationTag: string,
) {
  const publicKeyPoint =
    bls12_381.G2.ProjectivePoint.fromHex(publicKey).negate();
  const hashedMessage = bls12_381.G1.hashToCurve(message, {
    DST: domainSeparationTag,
  });
  const messagePoint = bls12_381.G1.ProjectivePoint.fromAffine(
    hashedMessage.toAffine(),
  );
  const signaturePoint = bls12_381.G1.ProjectivePoint.fromHex(signature);
  const messagePairing = bls12_381.pairing(messagePoint, publicKeyPoint, true);
  const signaturePairing = bls12_381.pairing(
    signaturePoint,
    bls12_381.G2.ProjectivePoint.BASE,
    true,
  );
  return bls12_381.fields.Fp12.eql(
    bls12_381.fields.Fp12.mul(signaturePairing, messagePairing),
    bls12_381.fields.Fp12.ONE,
  );
}

function verifySignature(
  chain: PinnedDrandChain,
  message: Uint8Array,
  signature: Uint8Array,
) {
  const publicKey = hexBytes(chain.publicKey);
  switch (chain.schemeId) {
    case "pedersen-bls-chained":
    case "pedersen-bls-unchained":
      return bls12_381.verify(signature, message, publicKey);
    case "bls-unchained-on-g1":
      return verifyG1Signature(
        signature,
        message,
        publicKey,
        "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
      );
    case "bls-unchained-g1-rfc9380":
      return verifyG1Signature(
        signature,
        message,
        publicKey,
        "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_",
      );
  }
}

/**
 * Verifies a drand beacon against application-pinned chain information.
 *
 * Checking `randomness = sha256(signature)` is only an evidence-integrity
 * check. This function also verifies the BLS signature over the round (and,
 * for chained networks, the previous signature) with the pinned public key.
 */
export function verifyDrandBeaconEvidence(input: {
  chain: PinnedDrandChain;
  chainInfo: DrandChainInfo;
  beacon: DrandBeaconEvidence;
  expectedRound: number;
}): VerifiedDrandBeaconEvidence {
  assertPinnedDrandChainInfo(input.chain, input.chainInfo);
  const { randomness, signature, previousSignature } = assertEvidenceShape(
    input.chain,
    input.beacon,
    input.expectedRound,
  );
  const signatureBytes = hexBytes(signature);
  if (hex(sha256(signatureBytes)) !== randomness) {
    throw new DrandVerificationError(
      "Drand randomness is not the SHA-256 digest of its signature.",
    );
  }
  const round = uint64(BigInt(input.beacon.round), "Drand round");
  const message = sha256(
    previousSignature ? concat(hexBytes(previousSignature), round) : round,
  );
  let verified = false;
  try {
    verified = verifySignature(input.chain, message, signatureBytes);
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new DrandVerificationError(
      "Drand BLS signature does not verify against the pinned public key.",
    );
  }
  return {
    chain: input.chain,
    round: input.beacon.round,
    randomness: `0x${randomness}`,
    signature: `0x${signature}`,
    ...(previousSignature
      ? { previousSignature: `0x${previousSignature}` as const }
      : {}),
  };
}

function lengthPrefixed(value: Uint8Array) {
  if (value.length > 0xffff_ffff) {
    throw new DrandVerificationError(
      "Reference-sample seed field is too long.",
    );
  }
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, value.length, false);
  return concat(length, value);
}

function textField(value: string) {
  return lengthPrefixed(UTF8.encode(value));
}

/**
 * Derives the public reference-sampling seed from a verified beacon and an
 * unambiguous, domain-separated encoding of the frozen frame and method.
 */
export function deriveReferenceSampleSeed(input: {
  chain: PinnedDrandChain;
  chainInfo: DrandChainInfo;
  beacon: DrandBeaconEvidence;
  expectedRound: number;
  frameDigest: string;
  samplingMethod: string;
}): `sha256:${string}` {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(input.samplingMethod)) {
    throw new DrandVerificationError(
      "Reference-sampling method must be a stable lowercase identifier.",
    );
  }
  const frameDigest = normalizeHex(
    input.frameDigest.replace(/^sha256:/u, ""),
    32,
    "Reference-sampling frame digest",
  );
  const verified = verifyDrandBeaconEvidence(input);
  const previousSignature = verified.previousSignature
    ? concat(
        Uint8Array.of(1),
        lengthPrefixed(hexBytes(verified.previousSignature)),
      )
    : Uint8Array.of(0);
  const material = concat(
    textField(REFERENCE_SAMPLE_SEED_DOMAIN),
    textField(input.chain.networkId),
    hexBytes(input.chain.chainHash),
    lengthPrefixed(hexBytes(input.chain.publicKey)),
    textField(input.chain.schemeId),
    uint64(BigInt(input.chain.genesisTime), "Drand genesis time"),
    uint64(BigInt(input.chain.period), "Drand period"),
    hexBytes(input.chain.groupHash),
    textField(input.chain.beaconId),
    uint64(BigInt(verified.round), "Drand round"),
    hexBytes(verified.randomness),
    lengthPrefixed(hexBytes(verified.signature)),
    previousSignature,
    hexBytes(frameDigest),
    textField(input.samplingMethod),
  );
  return `sha256:${hex(sha256(material))}`;
}
