import { Buffer } from "buffer";
import { decodeAbiParameters, encodeAbiParameters, hexToString, keccak256, encodePacked, stringToHex, type Address } from "viem";

export type VoteSalt = `0x${string}`;
export type VoteCiphertext = `0x${string}`;
export type VoteCommitHash = `0x${string}`;
export type VoteDrandChainHash = `0x${string}`;
export type PredictionCommitHash = VoteCommitHash;
export interface VoteCommitMetadata {
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
}
export interface TlockCiphertextMetadata extends VoteCommitMetadata {}
type TlockChainInfo = {
  period: number;
  genesis_time: number;
  hash: string;
};
type TlockClient = {
  chain: () => {
    info: () => Promise<TlockChainInfo>;
  };
};
type TlockEncryptFn = (targetRound: number, payload: Uint8Array, client: unknown) => Promise<string>;
type TlockDecryptFn = (ciphertext: string, client: unknown) => Promise<Uint8Array>;
type TlockModule = {
  mainnetClient: () => TlockClient;
  timelockEncrypt: TlockEncryptFn;
  timelockDecrypt: TlockDecryptFn;
};

export interface VoteTlockChainInfo {
  periodSeconds: bigint;
  genesisTimeSeconds: bigint;
  drandChainHash: VoteDrandChainHash;
}

let tlockModulePromise: Promise<TlockModule> | undefined;

export interface VoteTransferPayload {
  contentId: bigint;
  roundId: bigint;
  roundReferenceRatingBps: number;
  commitHash: VoteCommitHash;
  ciphertext: VoteCiphertext;
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
  frontend: Address;
}
export interface PredictionTransferPayload extends VoteTransferPayload {
  commitHash: PredictionCommitHash;
}
export type VoteTlockRuntime = {
  client?: TlockClient;
  now?: () => number;
  targetRound?: bigint | number;
  encryptFn?: TlockEncryptFn;
  decryptFn?: TlockDecryptFn;
};

const voteTransferPayloadParams = [
  { name: "contentId", type: "uint256" },
  { name: "roundContext", type: "uint256" },
  { name: "commitHash", type: "bytes32" },
  { name: "ciphertext", type: "bytes" },
  { name: "frontend", type: "address" },
  { name: "targetRound", type: "uint64" },
  { name: "drandChainHash", type: "bytes32" },
] as const;

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
export const MIN_PREDICTED_RATING_BPS = 0;
export const MAX_PREDICTED_RATING_BPS = 10_000;
export const RATING_SCALE_MAX = 10;

export function normalizePredictedRatingBps(predictedRatingBps: number): number {
  if (
    !Number.isInteger(predictedRatingBps) ||
    predictedRatingBps < MIN_PREDICTED_RATING_BPS ||
    predictedRatingBps > MAX_PREDICTED_RATING_BPS
  ) {
    throw new Error("predictedRatingBps must be an integer from 0 to 10000");
  }

  return predictedRatingBps;
}

export function ratingToBps(rating: number): number {
  if (!Number.isFinite(rating) || rating < 0 || rating > RATING_SCALE_MAX) {
    throw new Error("rating must be from 0 to 10");
  }

  return normalizePredictedRatingBps(Math.round(rating * 1_000));
}

export function bpsToRating(predictedRatingBps: number): number {
  return normalizePredictedRatingBps(predictedRatingBps) / 1_000;
}

export function packVoteRoundContext(roundId: bigint, roundReferenceRatingBps: number): bigint {
  if (roundId <= 0n) {
    throw new Error("roundId must be positive");
  }
  if (!Number.isInteger(roundReferenceRatingBps) || roundReferenceRatingBps < 0 || roundReferenceRatingBps > 65_535) {
    throw new Error("roundReferenceRatingBps must fit uint16");
  }

  return (roundId << 16n) | BigInt(roundReferenceRatingBps);
}

export function unpackVoteRoundContext(roundContext: bigint): { roundId: bigint; roundReferenceRatingBps: number } {
  return {
    roundId: roundContext >> 16n,
    roundReferenceRatingBps: Number(roundContext & ROUND_REFERENCE_RATING_MASK),
  };
}

async function loadTlockModule(): Promise<TlockModule> {
  tlockModulePromise ??= import("tlock-js").then(module => ({
    mainnetClient: module.mainnetClient as TlockModule["mainnetClient"],
    timelockEncrypt: module.timelockEncrypt as TlockModule["timelockEncrypt"],
    timelockDecrypt: module.timelockDecrypt as TlockModule["timelockDecrypt"],
  }));

  return tlockModulePromise;
}

export async function getVoteTlockChainInfo(runtime: VoteTlockRuntime = {}): Promise<VoteTlockChainInfo> {
  const { mainnetClient } = await loadTlockModule();
  const client = runtime.client ?? mainnetClient();
  const chainInfo = await client.chain().info();

  return {
    periodSeconds: BigInt(chainInfo.period),
    genesisTimeSeconds: BigInt(chainInfo.genesis_time),
    drandChainHash: `0x${chainInfo.hash.toLowerCase()}` as VoteDrandChainHash,
  };
}

export function deriveVoteTlockRevealAvailableAtSeconds(
  targetRound: bigint,
  chainInfo: VoteTlockChainInfo,
): bigint {
  if (targetRound <= 0n || chainInfo.periodSeconds <= 0n) {
    return 0n;
  }

  return chainInfo.genesisTimeSeconds + (targetRound - 1n) * chainInfo.periodSeconds;
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
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

export function encodeVotePlaintext(isUp: boolean, salt: VoteSalt): Uint8Array {
  const plaintext = new Uint8Array(33);
  plaintext[0] = isUp ? 1 : 0;
  plaintext.set(saltToBytes(salt), 1);
  return plaintext;
}

export function decodeVotePlaintext(plaintext: Uint8Array): { isUp: boolean; salt: VoteSalt } | null {
  if (plaintext.length !== 33) return null;

  return {
    isUp: plaintext[0] === 1,
    salt: bytesToHex(plaintext.slice(1, 33)),
  };
}

export function encodePredictionPlaintext(predictedRatingBps: number, salt: VoteSalt): Uint8Array {
  const normalizedRating = normalizePredictedRatingBps(predictedRatingBps);
  const plaintext = new Uint8Array(34);
  plaintext[0] = normalizedRating >> 8;
  plaintext[1] = normalizedRating & 0xff;
  plaintext.set(saltToBytes(salt), 2);
  return plaintext;
}

export function decodePredictionPlaintext(
  plaintext: Uint8Array,
): { predictedRatingBps: number; rating: number; salt: VoteSalt } | null {
  if (plaintext.length !== 34) return null;

  const predictedRatingBps = (plaintext[0] << 8) | plaintext[1];
  if (predictedRatingBps > MAX_PREDICTED_RATING_BPS) return null;

  return {
    predictedRatingBps,
    rating: bpsToRating(predictedRatingBps),
    salt: bytesToHex(plaintext.slice(2, 34)),
  };
}

export function buildCommitHash(
  isUp: boolean,
  salt: VoteSalt,
  voter: Address,
  contentId: bigint,
  roundId: bigint,
  roundReferenceRatingBps: number,
  targetRound: bigint,
  drandChainHash: VoteDrandChainHash,
  ciphertext: VoteCiphertext,
): VoteCommitHash {
  return keccak256(
    encodePacked(
      ["bool", "bytes32", "address", "uint256", "uint256", "uint16", "uint64", "bytes32", "bytes32"],
      [isUp, salt, voter, contentId, roundId, roundReferenceRatingBps, targetRound, drandChainHash, keccak256(ciphertext)],
    ),
  );
}

export function buildPredictionCommitHash(
  predictedRatingBps: number,
  salt: VoteSalt,
  voter: Address,
  contentId: bigint,
  roundId: bigint,
  roundReferenceRatingBps: number,
  targetRound: bigint,
  drandChainHash: VoteDrandChainHash,
  ciphertext: VoteCiphertext,
): PredictionCommitHash {
  return keccak256(
    encodePacked(
      ["uint16", "bytes32", "address", "uint256", "uint256", "uint16", "uint64", "bytes32", "bytes32"],
      [
        normalizePredictedRatingBps(predictedRatingBps),
        salt,
        voter,
        contentId,
        roundId,
        roundReferenceRatingBps,
        targetRound,
        drandChainHash,
        keccak256(ciphertext),
      ],
    ),
  );
}

export function buildCommitKey(voter: Address, commitHash: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(["address", "bytes32"], [voter, commitHash]));
}

export function encodeVoteTransferPayload(payload: VoteTransferPayload): `0x${string}` {
  const roundContext = packVoteRoundContext(payload.roundId, payload.roundReferenceRatingBps);
  return encodeAbiParameters(voteTransferPayloadParams, [
    payload.contentId,
    roundContext,
    payload.commitHash,
    payload.ciphertext,
    payload.frontend,
    payload.targetRound,
    payload.drandChainHash,
  ]);
}

export function decodeVoteTransferPayload(data: `0x${string}`): VoteTransferPayload {
  try {
    const [contentId, roundContext, commitHash, ciphertext, frontend, targetRound, drandChainHash] = decodeAbiParameters(
      voteTransferPayloadParams,
      data,
    );
    const { roundId, roundReferenceRatingBps } = unpackVoteRoundContext(roundContext);
    const reencoded = encodeAbiParameters(voteTransferPayloadParams, [
      contentId,
      roundContext,
      commitHash,
      ciphertext,
      frontend,
      targetRound,
      drandChainHash,
    ]);
    if (reencoded.toLowerCase() !== data.toLowerCase()) {
      throw new Error("invalid vote transfer payload");
    }

    return {
      contentId,
      roundId,
      roundReferenceRatingBps,
      commitHash,
      ciphertext,
      frontend,
      targetRound,
      drandChainHash,
    };
  } catch {
    throw new Error("invalid vote transfer payload");
  }
}

function decodeAgeArmor(armored: string): Buffer | null {
  const trimmed = armored.trim();
  if (!trimmed.startsWith(AGE_ARMOR_HEADER) || !trimmed.endsWith(AGE_ARMOR_FOOTER)) {
    return null;
  }

  const payload = trimmed.slice(AGE_ARMOR_HEADER.length, trimmed.length - AGE_ARMOR_FOOTER.length);
  const lines = payload.split(/\r?\n/);
  if (lines.some(line => line.length > AGE_ARMOR_LINE_CHUNK_SIZE)) {
    return null;
  }
  if (lines.some(line => line.length > 0 && !/^[A-Za-z0-9+/=]+$/.test(line))) {
    return null;
  }

  const lastLine = lines.at(-1) ?? "";
  if (lastLine.length > AGE_ARMOR_LINE_CHUNK_SIZE) {
    return null;
  }

  return Buffer.from(payload, "base64");
}

function readAsciiLine(payload: Buffer, cursor: number): { line: string; nextCursor: number } | null {
  if (cursor >= payload.length) return null;

  let end = cursor;
  while (end < payload.length && payload[end] !== 0x0a && payload[end] !== 0x0d) {
    end++;
  }
  if (end >= payload.length) {
    return null;
  }

  let nextCursor = end + 1;
  if (payload[end] === 0x0d && nextCursor < payload.length && payload[nextCursor] === 0x0a) {
    nextCursor++;
  }

  return {
    line: payload.subarray(cursor, end).toString("binary"),
    nextCursor,
  };
}

function isValidUnpaddedBase64Line(line: string): boolean {
  return line.length > 0 && line.length <= AGE_ARMOR_LINE_CHUNK_SIZE && UNPADDED_BASE64_LINE.test(line);
}

function unpaddedBase64DecodedLength(charLength: number): number | null {
  const remainder = charLength % 4;
  if (remainder === 1) return null;
  return Math.floor(charLength / 4) * 3 + (remainder === 0 ? 0 : remainder - 1);
}

export function parseTlockCiphertextMetadata(ciphertext: VoteCiphertext): TlockCiphertextMetadata | null {
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

    const recipientMatch = /^-> tlock ([0-9]+) ([0-9a-fA-F]{64})$/.exec(stanzaLine.line);
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
      if (bodyLine.line.startsWith(AGE_RECIPIENT_PREFIX) || !isValidUnpaddedBase64Line(bodyLine.line)) {
        return null;
      }

      stanzaBodyCharLength += bodyLine.line.length;
      cursor = bodyLine.nextCursor;
    }

    const decodedStanzaBodyLength = unpaddedBase64DecodedLength(stanzaBodyCharLength);
    if (decodedStanzaBodyLength == null || decodedStanzaBodyLength < MIN_TLOCK_STANZA_BODY_LENGTH) {
      return null;
    }

    const macLine = readAsciiLine(agePayload, cursor);
    if (!macLine || !macLine.line.startsWith(AGE_MAC_PREFIX)) {
      return null;
    }

    const mac = macLine.line.slice(AGE_MAC_PREFIX.length);
    const decodedMacLength = unpaddedBase64DecodedLength(mac.length);
    if (!isValidUnpaddedBase64Line(mac) || decodedMacLength !== AGE_MAC_LENGTH) {
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

async function createTlockVoteArtifacts(
  isUp: boolean,
  salt: VoteSalt,
  epochDurationSeconds: number,
  runtime: VoteTlockRuntime = {},
): Promise<{ ciphertext: VoteCiphertext; targetRound: bigint; drandChainHash: VoteDrandChainHash }> {
  const { mainnetClient, timelockEncrypt } = await loadTlockModule();
  const client = runtime.client ?? mainnetClient();
  const now = runtime.now ?? Date.now;
  const encryptFn = runtime.encryptFn ?? timelockEncrypt;
  const chainInfo = await client.chain().info();
  const targetRound =
    runtime.targetRound != null
      ? normalizeTlockTargetRound(runtime.targetRound)
      : roundAtOrAfter(now() + epochDurationSeconds * 1000, chainInfo);
  const armored = await encryptFn(targetRound, Buffer.from(encodeVotePlaintext(isUp, salt)), client);
  return {
    ciphertext: stringToHex(armored) as VoteCiphertext,
    targetRound: BigInt(targetRound),
    drandChainHash: `0x${chainInfo.hash}` as VoteDrandChainHash,
  };
}

async function createTlockPredictionArtifacts(
  predictedRatingBps: number,
  salt: VoteSalt,
  epochDurationSeconds: number,
  runtime: VoteTlockRuntime = {},
): Promise<{ ciphertext: VoteCiphertext; targetRound: bigint; drandChainHash: VoteDrandChainHash }> {
  const { mainnetClient, timelockEncrypt } = await loadTlockModule();
  const client = runtime.client ?? mainnetClient();
  const now = runtime.now ?? Date.now;
  const encryptFn = runtime.encryptFn ?? timelockEncrypt;
  const chainInfo = await client.chain().info();
  const targetRound =
    runtime.targetRound != null
      ? normalizeTlockTargetRound(runtime.targetRound)
      : roundAtOrAfter(now() + epochDurationSeconds * 1000, chainInfo);
  const armored = await encryptFn(targetRound, Buffer.from(encodePredictionPlaintext(predictedRatingBps, salt)), client);
  return {
    ciphertext: stringToHex(armored) as VoteCiphertext,
    targetRound: BigInt(targetRound),
    drandChainHash: `0x${chainInfo.hash}` as VoteDrandChainHash,
  };
}

function roundAtOrAfter(targetTimeMs: number, chainInfo: TlockChainInfo): number {
  if (!Number.isFinite(targetTimeMs)) {
    throw new Error("Cannot use Infinity or NaN as a beacon time");
  }

  const genesisTimeMs = chainInfo.genesis_time * 1000;
  const periodMs = chainInfo.period * 1000;
  if (!Number.isFinite(genesisTimeMs) || !Number.isFinite(periodMs) || periodMs <= 0) {
    throw new Error("Invalid tlock chain timing");
  }
  if (targetTimeMs < genesisTimeMs) {
    throw new Error("Cannot request a round before the genesis time");
  }

  return Math.ceil((targetTimeMs - genesisTimeMs) / periodMs) + 1;
}

function normalizeTlockTargetRound(targetRound: bigint | number): number {
  const normalized =
    typeof targetRound === "bigint"
      ? Number(targetRound)
      : Number.isInteger(targetRound)
        ? targetRound
        : Number.NaN;

  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error("targetRound must be a positive safe integer");
  }

  return normalized;
}

export async function tlockEncryptVote(
  isUp: boolean,
  salt: VoteSalt,
  epochDurationSeconds: number,
  runtime: VoteTlockRuntime = {},
): Promise<VoteCiphertext> {
  const { ciphertext } = await createTlockVoteArtifacts(isUp, salt, epochDurationSeconds, runtime);
  return ciphertext;
}

export async function decryptTlockCiphertext(
  ciphertext: VoteCiphertext,
  runtime: VoteTlockRuntime = {},
): Promise<{ isUp: boolean; salt: VoteSalt } | null> {
  const { mainnetClient, timelockDecrypt } = await loadTlockModule();
  const client = runtime.client ?? mainnetClient();
  const decryptFn = runtime.decryptFn ?? timelockDecrypt;
  const armored = hexToString(ciphertext);
  const plaintext = await decryptFn(armored, client);
  return decodeVotePlaintext(plaintext);
}

export async function decryptTlockPredictionCiphertext(
  ciphertext: VoteCiphertext,
  runtime: VoteTlockRuntime = {},
): Promise<{ predictedRatingBps: number; rating: number; salt: VoteSalt } | null> {
  const { mainnetClient, timelockDecrypt } = await loadTlockModule();
  const client = runtime.client ?? mainnetClient();
  const decryptFn = runtime.decryptFn ?? timelockDecrypt;
  const armored = hexToString(ciphertext);
  const plaintext = await decryptFn(armored, client);
  return decodePredictionPlaintext(plaintext);
}

export async function createTlockVoteCommit(params: {
  voter: Address;
  isUp: boolean;
  salt: VoteSalt;
  contentId: bigint;
  roundId: bigint;
  roundReferenceRatingBps: number;
  epochDurationSeconds: number;
}, runtime: VoteTlockRuntime = {}): Promise<{
  ciphertext: VoteCiphertext;
  commitHash: `0x${string}`;
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
  roundReferenceRatingBps: number;
  commitKey: `0x${string}`;
}> {
  const { ciphertext, targetRound, drandChainHash } = await createTlockVoteArtifacts(
    params.isUp,
    params.salt,
    params.epochDurationSeconds,
    runtime,
  );
  const commitHash = buildCommitHash(
    params.isUp,
    params.salt,
    params.voter,
    params.contentId,
    params.roundId,
    params.roundReferenceRatingBps,
    targetRound,
    drandChainHash,
    ciphertext,
  );

  return {
    ciphertext,
    commitHash,
    targetRound,
    drandChainHash,
    roundReferenceRatingBps: params.roundReferenceRatingBps,
    commitKey: buildCommitKey(params.voter, commitHash),
  };
}

export async function createTlockPredictionCommit(params: {
  voter: Address;
  predictedRatingBps: number;
  salt: VoteSalt;
  contentId: bigint;
  roundId: bigint;
  roundReferenceRatingBps: number;
  epochDurationSeconds: number;
}, runtime: VoteTlockRuntime = {}): Promise<{
  ciphertext: VoteCiphertext;
  commitHash: PredictionCommitHash;
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
  roundReferenceRatingBps: number;
  predictedRatingBps: number;
  commitKey: `0x${string}`;
}> {
  const predictedRatingBps = normalizePredictedRatingBps(params.predictedRatingBps);
  const { ciphertext, targetRound, drandChainHash } = await createTlockPredictionArtifacts(
    predictedRatingBps,
    params.salt,
    params.epochDurationSeconds,
    runtime,
  );
  const commitHash = buildPredictionCommitHash(
    predictedRatingBps,
    params.salt,
    params.voter,
    params.contentId,
    params.roundId,
    params.roundReferenceRatingBps,
    targetRound,
    drandChainHash,
    ciphertext,
  );

  return {
    ciphertext,
    commitHash,
    targetRound,
    drandChainHash,
    roundReferenceRatingBps: params.roundReferenceRatingBps,
    predictedRatingBps,
    commitKey: buildCommitKey(params.voter, commitHash),
  };
}
