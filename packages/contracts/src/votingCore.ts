import { Buffer } from "buffer";
import { encodePacked, hexToString, keccak256, type Address } from "viem";
import { USER_PREDICTION_BPS, USER_PREDICTION_PERCENT } from "./protocol";

export type VoteSalt = `0x${string}`;
export type VoteCiphertext = `0x${string}`;
export type VoteCommitHash = `0x${string}`;
export type VoteDrandChainHash = `0x${string}`;
export type RbtsCommitHash = VoteCommitHash;

export interface VoteCommitMetadata {
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
}

export interface TlockCiphertextMetadata extends VoteCommitMetadata {}

export interface VoteTlockChainInfo {
  periodSeconds: bigint;
  genesisTimeSeconds: bigint;
  drandChainHash: VoteDrandChainHash;
}

const AGE_ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";
const AGE_ARMOR_FOOTER = "-----END AGE ENCRYPTED FILE-----";
const AGE_ARMOR_LINE_CHUNK_SIZE = 64;
const AGE_VERSION_LINE = "age-encryption.org/v1";
const AGE_RECIPIENT_PREFIX = "-> ";
const AGE_MAC_PREFIX = "--- ";
const TLOCK_STANZA_PREFIX = "-> tlock ";
const UNPADDED_BASE64_LINE = /^[A-Za-z0-9+/]+$/;
const AGE_MAC_LENGTH = 32;
const MIN_TLOCK_STANZA_BODY_LENGTH = 80;
const MIN_ENCRYPTED_BODY_LENGTH = 65;
const ROUND_REFERENCE_RATING_MASK = 0xffffn;
const RBTS_PLAINTEXT_VERSION = 2;

export const MIN_PREDICTED_UP_BPS = USER_PREDICTION_BPS.min;
export const MAX_PREDICTED_UP_BPS = USER_PREDICTION_BPS.max;
export const MIN_PREDICTED_UP_PERCENT = USER_PREDICTION_PERCENT.min;
export const MAX_PREDICTED_UP_PERCENT = USER_PREDICTION_PERCENT.max;

export function normalizePredictedUpBps(predictedUpBps: number): number {
  if (
    !Number.isInteger(predictedUpBps) ||
    predictedUpBps < MIN_PREDICTED_UP_BPS ||
    predictedUpBps > MAX_PREDICTED_UP_BPS
  ) {
    throw new Error("predictedUpBps must be an integer from 100 to 9900");
  }

  return predictedUpBps;
}

export function predictionPercentToBps(predictedUpPercent: number): number {
  if (
    !Number.isFinite(predictedUpPercent) ||
    predictedUpPercent < MIN_PREDICTED_UP_PERCENT ||
    predictedUpPercent > MAX_PREDICTED_UP_PERCENT
  ) {
    throw new Error("predicted up percentage must be from 1 to 99");
  }

  return normalizePredictedUpBps(Math.round(predictedUpPercent * 100));
}

export function bpsToPredictionPercent(predictedUpBps: number): number {
  return normalizePredictedUpBps(predictedUpBps) / 100;
}

export function packVoteRoundContext(
  roundId: bigint,
  roundReferenceRatingBps: number,
): bigint {
  if (roundId <= 0n) {
    throw new Error("roundId must be positive");
  }
  if (
    !Number.isInteger(roundReferenceRatingBps) ||
    roundReferenceRatingBps < 0 ||
    roundReferenceRatingBps > 65_535
  ) {
    throw new Error("roundReferenceRatingBps must fit uint16");
  }

  return (roundId << 16n) | BigInt(roundReferenceRatingBps);
}

export function unpackVoteRoundContext(roundContext: bigint): {
  roundId: bigint;
  roundReferenceRatingBps: number;
} {
  return {
    roundId: roundContext >> 16n,
    roundReferenceRatingBps: Number(roundContext & ROUND_REFERENCE_RATING_MASK),
  };
}

/**
 * C-3 (2026-05-22 audit): the formula here uses (targetRound - 1) * period because the
 * local convention (see voting.ts's computeTargetRoundForBeaconTime lineage) treats round
 * 1 as occurring at the genesis time itself. The drand network's own signature-publishing
 * schedule produces round R at `genesis + R * period`, so callers may see "reveal
 * available" up to one period before drand has actually published the round's signature;
 * this is currently absorbed as a brief retry at the call site.
 *
 * If a follow-up confirms drand's schedule should govern the displayed availability
 * (rather than the local round numbering), change to `targetRound * periodSeconds` and
 * update the boundary tests in voting.test.ts in lockstep. Do not change one without
 * the other.
 */
export function deriveVoteTlockRevealAvailableAtSeconds(
  targetRound: bigint,
  chainInfo: VoteTlockChainInfo,
): bigint {
  if (targetRound <= 0n || chainInfo.periodSeconds <= 0n) {
    return 0n;
  }

  return (
    chainInfo.genesisTimeSeconds + (targetRound - 1n) * chainInfo.periodSeconds
  );
}

function saltToBytes(salt: VoteSalt): Uint8Array {
  const hex = salt.startsWith("0x") ? salt.slice(2) : salt;
  if (hex.length !== 64) throw new Error("salt must be 32 bytes");

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

export function encodeRbtsVotePlaintext(
  isUp: boolean,
  predictedUpBps: number,
  salt: VoteSalt,
): Uint8Array {
  const normalizedPrediction = normalizePredictedUpBps(predictedUpBps);
  const plaintext = new Uint8Array(36);
  plaintext[0] = RBTS_PLAINTEXT_VERSION;
  plaintext[1] = isUp ? 1 : 0;
  plaintext[2] = normalizedPrediction >> 8;
  plaintext[3] = normalizedPrediction & 0xff;
  plaintext.set(saltToBytes(salt), 4);
  return plaintext;
}

export function decodeRbtsVotePlaintext(plaintext: Uint8Array): {
  isUp: boolean;
  predictedUpBps: number;
  predictedUpPercent: number;
  salt: VoteSalt;
} | null {
  if (plaintext.length !== 36 || plaintext[0] !== RBTS_PLAINTEXT_VERSION)
    return null;
  if (plaintext[1] !== 0 && plaintext[1] !== 1) return null;

  const predictedUpBps = (plaintext[2] << 8) | plaintext[3];
  if (
    predictedUpBps < MIN_PREDICTED_UP_BPS ||
    predictedUpBps > MAX_PREDICTED_UP_BPS
  )
    return null;
  return {
    isUp: plaintext[1] === 1,
    predictedUpBps,
    predictedUpPercent: bpsToPredictionPercent(predictedUpBps),
    salt: bytesToHex(plaintext.slice(4, 36)),
  };
}

export function buildCommitHash(
  isUp: boolean,
  predictedUpBps: number,
  salt: VoteSalt,
  voter: Address,
  contentId: bigint,
  roundId: bigint,
  roundReferenceRatingBps: number,
  targetRound: bigint,
  drandChainHash: VoteDrandChainHash,
  ciphertext: VoteCiphertext,
): VoteCommitHash {
  const ciphertextHash = keccak256(ciphertext);
  return keccak256(
    encodePacked(
      [
        "bool",
        "uint16",
        "bytes32",
        "address",
        "uint256",
        "uint256",
        "uint16",
        "uint64",
        "bytes32",
        "bytes32",
      ],
      [
        isUp,
        normalizePredictedUpBps(predictedUpBps),
        salt,
        voter,
        contentId,
        roundId,
        roundReferenceRatingBps,
        targetRound,
        drandChainHash,
        ciphertextHash,
      ],
    ),
  );
}

export function buildRbtsCommitHash(
  isUp: boolean,
  predictedUpBps: number,
  salt: VoteSalt,
  voter: Address,
  contentId: bigint,
  roundId: bigint,
  roundReferenceRatingBps: number,
  targetRound: bigint,
  drandChainHash: VoteDrandChainHash,
  ciphertext: VoteCiphertext,
): RbtsCommitHash {
  return buildCommitHash(
    isUp,
    predictedUpBps,
    salt,
    voter,
    contentId,
    roundId,
    roundReferenceRatingBps,
    targetRound,
    drandChainHash,
    ciphertext,
  );
}

export function buildCommitKey(
  voter: Address,
  commitHash: `0x${string}`,
): `0x${string}` {
  return keccak256(encodePacked(["address", "bytes32"], [voter, commitHash]));
}

function decodeAgeArmor(armored: string): Buffer | null {
  const trimmed = armored.trim();
  if (
    !trimmed.startsWith(AGE_ARMOR_HEADER) ||
    !trimmed.endsWith(AGE_ARMOR_FOOTER)
  ) {
    return null;
  }

  const payload = trimmed.slice(
    AGE_ARMOR_HEADER.length,
    trimmed.length - AGE_ARMOR_FOOTER.length,
  );
  const lines = payload.split(/\r?\n/);
  if (lines.some((line) => line.length > AGE_ARMOR_LINE_CHUNK_SIZE)) {
    return null;
  }
  if (
    lines.some((line) => line.length > 0 && !/^[A-Za-z0-9+/=]+$/.test(line))
  ) {
    return null;
  }

  const lastLine = lines.at(-1) ?? "";
  if (lastLine.length > AGE_ARMOR_LINE_CHUNK_SIZE) {
    return null;
  }

  return Buffer.from(payload, "base64");
}

function readAsciiLine(
  payload: Buffer,
  cursor: number,
): { line: string; nextCursor: number } | null {
  if (cursor >= payload.length) return null;

  let end = cursor;
  while (
    end < payload.length &&
    payload[end] !== 0x0a &&
    payload[end] !== 0x0d
  ) {
    end++;
  }
  if (end >= payload.length) {
    return null;
  }

  let nextCursor = end + 1;
  if (
    payload[end] === 0x0d &&
    nextCursor < payload.length &&
    payload[nextCursor] === 0x0a
  ) {
    nextCursor++;
  }

  return {
    line: payload.subarray(cursor, end).toString("binary"),
    nextCursor,
  };
}

function isValidUnpaddedBase64Line(line: string): boolean {
  return (
    line.length > 0 &&
    line.length <= AGE_ARMOR_LINE_CHUNK_SIZE &&
    UNPADDED_BASE64_LINE.test(line)
  );
}

function unpaddedBase64DecodedLength(charLength: number): number | null {
  const remainder = charLength % 4;
  if (remainder === 1) return null;
  return Math.floor(charLength / 4) * 3 + (remainder === 0 ? 0 : remainder - 1);
}

export function parseTlockCiphertextMetadata(
  ciphertext: VoteCiphertext,
): TlockCiphertextMetadata | null {
  try {
    const armored = hexToString(ciphertext);
    const agePayload = decodeAgeArmor(armored);
    if (!agePayload) return null;

    const versionLine = readAsciiLine(agePayload, 0);
    if (!versionLine || versionLine.line !== AGE_VERSION_LINE) {
      return null;
    }

    const stanzaLine = readAsciiLine(agePayload, versionLine.nextCursor);
    if (!stanzaLine || !stanzaLine.line.startsWith(TLOCK_STANZA_PREFIX)) {
      return null;
    }

    const recipientMatch = /^-> tlock ([0-9]+) ([0-9a-fA-F]{64})$/.exec(
      stanzaLine.line,
    );
    if (!recipientMatch) {
      return null;
    }

    let cursor = stanzaLine.nextCursor;
    let stanzaBodyCharLength = 0;
    while (cursor < agePayload.length) {
      const bodyLine = readAsciiLine(agePayload, cursor);
      if (!bodyLine) return null;
      if (bodyLine.line.startsWith(AGE_MAC_PREFIX)) {
        break;
      }
      if (
        bodyLine.line.startsWith(AGE_RECIPIENT_PREFIX) ||
        !isValidUnpaddedBase64Line(bodyLine.line)
      ) {
        return null;
      }

      stanzaBodyCharLength += bodyLine.line.length;
      cursor = bodyLine.nextCursor;
    }

    const decodedStanzaBodyLength =
      unpaddedBase64DecodedLength(stanzaBodyCharLength);
    if (
      decodedStanzaBodyLength == null ||
      decodedStanzaBodyLength < MIN_TLOCK_STANZA_BODY_LENGTH
    ) {
      return null;
    }

    const macLine = readAsciiLine(agePayload, cursor);
    if (!macLine || !macLine.line.startsWith(AGE_MAC_PREFIX)) {
      return null;
    }

    const mac = macLine.line.slice(AGE_MAC_PREFIX.length);
    const decodedMacLength = unpaddedBase64DecodedLength(mac.length);
    if (
      !isValidUnpaddedBase64Line(mac) ||
      decodedMacLength !== AGE_MAC_LENGTH
    ) {
      return null;
    }

    if (agePayload.length - macLine.nextCursor < MIN_ENCRYPTED_BODY_LENGTH) {
      return null;
    }

    const [, roundStr, chainHash] = recipientMatch;
    return {
      targetRound: BigInt(roundStr),
      drandChainHash: `0x${chainHash.toLowerCase()}` as VoteDrandChainHash,
    };
  } catch {
    return null;
  }
}
