import { Buffer } from "buffer";
import { hexToString, keccak256, stringToHex, type Address } from "viem";
import {
  bpsToPredictionPercent,
  buildCommitHash,
  buildCommitKey,
  buildRbtsCommitHash,
  decodeRbtsVotePlaintext,
  encodeRbtsVotePlaintext,
  normalizePredictedUpBps,
  type RbtsCommitHash,
  type VoteCiphertext,
  type VoteDrandChainHash,
  type VoteSalt,
  type VoteTlockChainInfo,
} from "./votingCore";

export {
  MAX_PREDICTED_UP_BPS,
  MAX_PREDICTED_UP_PERCENT,
  MIN_PREDICTED_UP_BPS,
  MIN_PREDICTED_UP_PERCENT,
  bpsToPredictionPercent,
  buildCommitHash,
  buildCommitKey,
  buildRbtsCommitHash,
  decodeRbtsVotePlaintext,
  deriveVoteTlockRevealAvailableAtSeconds,
  encodeRbtsVotePlaintext,
  normalizePredictedUpBps,
  packVoteRoundContext,
  parseTlockCiphertextMetadata,
  predictionPercentToBps,
  unpackVoteRoundContext,
  type RbtsCommitHash,
  type TlockCiphertextMetadata,
  type VoteCiphertext,
  type VoteCommitHash,
  type VoteCommitMetadata,
  type VoteDrandChainHash,
  type VoteSalt,
  type VoteTlockChainInfo,
} from "./votingCore";

type TlockChainInfo = {
  period: number;
  genesis_time: number;
  hash: string;
};
type TlockChainOptions = {
  disableBeaconVerification: boolean;
  noCache: boolean;
  chainVerificationParams?: {
    chainHash: string;
    publicKey: string;
  };
};
type TlockClient = {
  chain: () => {
    info: () => Promise<TlockChainInfo>;
  };
};
type TlockChain = {
  baseUrl: string;
  info: () => Promise<TlockChainInfo>;
};
type TlockEncryptFn = (
  targetRound: number,
  payload: Uint8Array,
  client: unknown,
) => Promise<string>;
type TlockDecryptFn = (
  ciphertext: string,
  client: unknown,
) => Promise<Uint8Array>;
type TlockModule = {
  HttpCachingChain: new (
    baseUrl: string,
    options?: TlockChainOptions,
  ) => TlockChain;
  HttpChainClient: new (
    chain: TlockChain,
    options?: TlockChainOptions,
    httpOptions?: { userAgent?: string },
  ) => TlockClient;
  mainnetClient: () => TlockClient;
  testnetClient: () => TlockClient;
  timelockEncrypt: TlockEncryptFn;
  timelockDecrypt: TlockDecryptFn;
};

let tlockModulePromise: Promise<TlockModule> | undefined;

export type VoteTlockRuntime = {
  client?: TlockClient;
  now?: () => number;
  roundStartTimeSeconds?: bigint | number | null;
  candidateTimestampOffsetsSeconds?: readonly number[];
  targetRound?: bigint | number;
  drandChainHash?: VoteDrandChainHash | null;
  drandGenesisTimeSeconds?: bigint | number | null;
  drandPeriodSeconds?: bigint | number | null;
  encryptFn?: TlockEncryptFn;
  decryptFn?: TlockDecryptFn;
};

const AGE_ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";
const AGE_ARMOR_FOOTER = "-----END AGE ENCRYPTED FILE-----";
const MIN_ENCRYPTED_BODY_LENGTH = 65;
const MAINNET_QUICKNET_CHAIN_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const TLOCK_JS_TESTNET_CHAIN_HASH =
  "7672797f548f3f4748ac4bf3352fc6c6b6468c9ad40ad456a397545c6e2df5bf";
const QUICKNET_T_CHAIN = {
  url: "https://testnet-api.drand.cloudflare.com/cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5",
  chainHash: "cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5",
  publicKey:
    "b15b65b46fb29104f6a4b5d1e11a8da6344463973d423661bb0804846a0ecd1ef93c25057f1c0baab2ac53e56c662b66072f6d84ee791a3382bfb055afab1e6a375538d8ffc451104ac971d2dc9b168e2d3246b0be2015969cbaac298f6502da",
} as const;
const RATELOOP_TLOCK_USER_AGENT = "rateloop-tlock";

async function loadTlockModule(): Promise<TlockModule> {
  tlockModulePromise ??= import("tlock-js").then((module) => ({
    HttpCachingChain:
      module.HttpCachingChain as TlockModule["HttpCachingChain"],
    HttpChainClient:
      module.HttpChainClient as unknown as TlockModule["HttpChainClient"],
    mainnetClient: module.mainnetClient as TlockModule["mainnetClient"],
    testnetClient: module.testnetClient as TlockModule["testnetClient"],
    timelockEncrypt: module.timelockEncrypt as TlockModule["timelockEncrypt"],
    timelockDecrypt: module.timelockDecrypt as TlockModule["timelockDecrypt"],
  }));

  return tlockModulePromise;
}

function normalizeDrandChainHash(
  hash: string | null | undefined,
): string | null {
  if (!hash) return null;
  const normalized = hash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error("Invalid drand chain hash");
  }
  return normalized.slice(2);
}

function normalizeOptionalPositiveBigInt(
  value: bigint | number | null | undefined,
  label: string,
): bigint | null {
  if (value == null) return null;
  const normalized =
    typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (normalized <= 0n) {
    throw new Error(`Invalid drand ${label}`);
  }
  return normalized;
}

function createHttpTlockClient(
  tlockModule: TlockModule,
  chain: typeof QUICKNET_T_CHAIN,
): TlockClient {
  const options: TlockChainOptions = {
    disableBeaconVerification: false,
    noCache: false,
    chainVerificationParams: {
      chainHash: chain.chainHash,
      publicKey: chain.publicKey,
    },
  };
  const httpChain = new tlockModule.HttpCachingChain(chain.url, options);
  return new tlockModule.HttpChainClient(httpChain, options, {
    userAgent: RATELOOP_TLOCK_USER_AGENT,
  });
}

function resolveTlockClientForRuntime(
  tlockModule: TlockModule,
  runtime: VoteTlockRuntime = {},
): TlockClient {
  if (runtime.client) {
    return runtime.client;
  }

  const expectedHash = normalizeDrandChainHash(runtime.drandChainHash);
  if (!expectedHash || expectedHash === MAINNET_QUICKNET_CHAIN_HASH) {
    return tlockModule.mainnetClient();
  }
  if (expectedHash === QUICKNET_T_CHAIN.chainHash) {
    return createHttpTlockClient(tlockModule, QUICKNET_T_CHAIN);
  }
  if (expectedHash === TLOCK_JS_TESTNET_CHAIN_HASH) {
    return tlockModule.testnetClient();
  }

  throw new Error(
    `Unsupported drand chain 0x${expectedHash}. Update ProtocolConfig to drand quicknet or quicknet-t before voting.`,
  );
}

function assertTlockChainInfoMatchesRuntime(
  chainInfo: TlockChainInfo,
  runtime: VoteTlockRuntime = {},
) {
  const expectedHash = normalizeDrandChainHash(runtime.drandChainHash);
  if (!expectedHash) return;

  const actualHash = chainInfo.hash.toLowerCase();
  if (actualHash !== expectedHash) {
    throw new Error(
      `Tlock client chain 0x${actualHash} does not match vote round drand chain 0x${expectedHash}.`,
    );
  }

  const expectedGenesisTime = normalizeOptionalPositiveBigInt(
    runtime.drandGenesisTimeSeconds,
    "genesis time",
  );
  if (
    expectedGenesisTime != null &&
    BigInt(chainInfo.genesis_time) !== expectedGenesisTime
  ) {
    throw new Error(
      `Tlock client genesis ${chainInfo.genesis_time} does not match vote round drand genesis ${expectedGenesisTime.toString()}.`,
    );
  }

  const expectedPeriod = normalizeOptionalPositiveBigInt(
    runtime.drandPeriodSeconds,
    "period",
  );
  if (expectedPeriod != null && BigInt(chainInfo.period) !== expectedPeriod) {
    throw new Error(
      `Tlock client period ${chainInfo.period} does not match vote round drand period ${expectedPeriod.toString()}.`,
    );
  }
}

export async function getVoteTlockChainInfo(
  runtime: VoteTlockRuntime = {},
): Promise<VoteTlockChainInfo> {
  const tlockModule = await loadTlockModule();
  const client = resolveTlockClientForRuntime(tlockModule, runtime);
  const chainInfo = await client.chain().info();
  assertTlockChainInfoMatchesRuntime(chainInfo, runtime);

  return {
    periodSeconds: BigInt(chainInfo.period),
    genesisTimeSeconds: BigInt(chainInfo.genesis_time),
    drandChainHash: `0x${chainInfo.hash.toLowerCase()}` as VoteDrandChainHash,
  };
}

async function createTlockVoteArtifacts(
  isUp: boolean,
  predictedUpBps: number,
  salt: VoteSalt,
  epochDurationSeconds: number,
  runtime: VoteTlockRuntime = {},
): Promise<{
  ciphertext: VoteCiphertext;
  ciphertextHash: `0x${string}`;
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
}> {
  const tlockModule = await loadTlockModule();
  const { timelockEncrypt } = tlockModule;
  const client = resolveTlockClientForRuntime(tlockModule, runtime);
  const now = runtime.now ?? Date.now;
  const encryptFn = runtime.encryptFn ?? timelockEncrypt;
  const chainInfo = await client.chain().info();
  assertTlockChainInfoMatchesRuntime(chainInfo, runtime);
  const targetRound =
    runtime.targetRound != null
      ? normalizeTlockTargetRound(runtime.targetRound)
      : deriveAcceptedTlockTargetRound(
          now(),
          epochDurationSeconds,
          chainInfo,
          runtime.roundStartTimeSeconds,
          runtime.candidateTimestampOffsetsSeconds,
        );
  const armored = await encryptFn(
    targetRound,
    Buffer.from(encodeRbtsVotePlaintext(isUp, predictedUpBps, salt)),
    client,
  );
  const ciphertext = stringToHex(armored) as VoteCiphertext;
  return {
    ciphertext,
    ciphertextHash: keccak256(ciphertext),
    targetRound: BigInt(targetRound),
    drandChainHash: `0x${chainInfo.hash}` as VoteDrandChainHash,
  };
}

function roundAtOrAfter(
  targetTimeMs: number,
  chainInfo: TlockChainInfo,
): number {
  if (!Number.isFinite(targetTimeMs)) {
    throw new Error("Cannot use Infinity or NaN as a beacon time");
  }

  const genesisTimeMs = chainInfo.genesis_time * 1000;
  const periodMs = chainInfo.period * 1000;
  if (
    !Number.isFinite(genesisTimeMs) ||
    !Number.isFinite(periodMs) ||
    periodMs <= 0
  ) {
    throw new Error("Invalid tlock chain timing");
  }
  if (targetTimeMs < genesisTimeMs) {
    throw new Error("Cannot request a round before the genesis time");
  }

  return Math.ceil((targetTimeMs - genesisTimeMs) / periodMs) + 1;
}

function roundAt(targetTimeMs: number, chainInfo: TlockChainInfo): number {
  const genesisTimeMs = chainInfo.genesis_time * 1000;
  const periodMs = chainInfo.period * 1000;
  if (
    !Number.isFinite(genesisTimeMs) ||
    !Number.isFinite(periodMs) ||
    periodMs <= 0
  ) {
    throw new Error("Invalid tlock chain timing");
  }
  if (targetTimeMs < genesisTimeMs) {
    throw new Error("Cannot request a round before the genesis time");
  }

  return Math.floor((targetTimeMs - genesisTimeMs) / periodMs) + 1;
}

function normalizeRoundStartTimeMs(
  roundStartTimeSeconds: VoteTlockRuntime["roundStartTimeSeconds"],
): number | null {
  if (roundStartTimeSeconds == null) return null;
  const normalized =
    typeof roundStartTimeSeconds === "bigint"
      ? Number(roundStartTimeSeconds)
      : Number(roundStartTimeSeconds);

  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return Math.floor(normalized) * 1000;
}

function deriveRevealableAfterMs(
  commitTimeMs: number,
  epochDurationSeconds: number,
  roundStartTimeMs: number | null,
): number {
  const epochDurationMs = Math.max(1, Math.floor(epochDurationSeconds)) * 1000;
  const anchorTimeMs = roundStartTimeMs ?? commitTimeMs;
  const elapsedMs = Math.max(0, commitTimeMs - anchorTimeMs);
  const epochIndex = Math.floor(elapsedMs / epochDurationMs);
  return anchorTimeMs + (epochIndex + 1) * epochDurationMs;
}

function deriveAcceptedTlockTargetRound(
  nowMs: number,
  epochDurationSeconds: number,
  chainInfo: TlockChainInfo,
  roundStartTimeSeconds: VoteTlockRuntime["roundStartTimeSeconds"],
  candidateTimestampOffsetsSeconds?: readonly number[],
): number {
  if (!Number.isFinite(nowMs)) {
    throw new Error("Cannot use Infinity or NaN as a beacon time");
  }

  const roundStartTimeMs = normalizeRoundStartTimeMs(roundStartTimeSeconds);
  const drandPeriodMs = Math.max(1, Math.floor(chainInfo.period)) * 1000;
  const candidateOffsets =
    candidateTimestampOffsetsSeconds &&
    candidateTimestampOffsetsSeconds.length > 0
      ? candidateTimestampOffsetsSeconds
      : buildDefaultCandidateTimestampOffsetsSeconds(chainInfo.period);
  let minAcceptedTargetRound = 0;
  let maxAcceptedTargetRound = 0;

  for (const offsetSeconds of candidateOffsets) {
    const commitTimeMs = nowMs + Math.floor(offsetSeconds) * 1000;
    const revealableAfterMs = deriveRevealableAfterMs(
      commitTimeMs,
      epochDurationSeconds,
      roundStartTimeMs,
    );
    const minTargetRound = roundAtOrAfter(revealableAfterMs, chainInfo);
    const maxTargetRound = roundAt(
      revealableAfterMs + 2 * drandPeriodMs,
      chainInfo,
    );

    if (
      minTargetRound <= 0 ||
      maxTargetRound <= 0 ||
      minTargetRound > maxTargetRound
    ) {
      throw new Error("No valid drand target round for the commit window");
    }

    minAcceptedTargetRound = Math.max(minAcceptedTargetRound, minTargetRound);
    maxAcceptedTargetRound =
      maxAcceptedTargetRound === 0
        ? maxTargetRound
        : Math.min(maxAcceptedTargetRound, maxTargetRound);
  }

  if (
    minAcceptedTargetRound === 0 ||
    minAcceptedTargetRound > maxAcceptedTargetRound
  ) {
    throw new Error("No shared drand target round for commit windows");
  }

  return maxAcceptedTargetRound;
}

function buildDefaultCandidateTimestampOffsetsSeconds(
  drandPeriodSeconds: number,
): number[] {
  const safePeriodSeconds = Math.max(1, Math.floor(drandPeriodSeconds));
  return Array.from({ length: safePeriodSeconds }, (_, index) => index);
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
  predictedUpBps: number,
  salt: VoteSalt,
  epochDurationSeconds: number,
  runtime: VoteTlockRuntime = {},
): Promise<VoteCiphertext> {
  const { ciphertext } = await createTlockVoteArtifacts(
    isUp,
    predictedUpBps,
    salt,
    epochDurationSeconds,
    runtime,
  );
  return ciphertext;
}

export async function decryptTlockVoteCiphertext(
  ciphertext: VoteCiphertext,
  runtime: VoteTlockRuntime = {},
): Promise<{
  isUp: boolean;
  predictedUpBps: number;
  predictedUpPercent: number;
  salt: VoteSalt;
} | null> {
  const tlockModule = await loadTlockModule();
  const { timelockDecrypt } = tlockModule;
  const client = resolveTlockClientForRuntime(tlockModule, runtime);
  const decryptFn = runtime.decryptFn ?? timelockDecrypt;
  const armored = hexToString(ciphertext);
  // Cheap structural sanity check before handing the payload to the tlock library.
  // The age armor header alone is ~36 chars and the smallest valid body is bounded by
  // MIN_ENCRYPTED_BODY_LENGTH, so anything shorter than the armor framing + body
  // floor cannot plausibly decrypt to our 36-byte RBTS plaintext.
  if (
    armored.length <
    AGE_ARMOR_HEADER.length +
      AGE_ARMOR_FOOTER.length +
      MIN_ENCRYPTED_BODY_LENGTH
  ) {
    return null;
  }
  if (
    !armored.includes(AGE_ARMOR_HEADER) ||
    !armored.includes(AGE_ARMOR_FOOTER)
  ) {
    return null;
  }
  if (runtime.drandChainHash) {
    const chainInfo = await client.chain().info();
    assertTlockChainInfoMatchesRuntime(chainInfo, runtime);
  }
  const plaintext = await decryptFn(armored, client);
  return decodeRbtsVotePlaintext(plaintext);
}

export async function createTlockVoteCommit(
  params: {
    voter: Address;
    isUp: boolean;
    predictedUpBps: number;
    salt: VoteSalt;
    contentId: bigint;
    roundId: bigint;
    roundReferenceRatingBps: number;
    epochDurationSeconds: number;
  },
  runtime: VoteTlockRuntime = {},
): Promise<{
  ciphertext: VoteCiphertext;
  ciphertextHash: `0x${string}`;
  commitHash: `0x${string}`;
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
  roundReferenceRatingBps: number;
  commitKey: `0x${string}`;
}> {
  const { ciphertext, ciphertextHash, targetRound, drandChainHash } =
    await createTlockVoteArtifacts(
      params.isUp,
      params.predictedUpBps,
      params.salt,
      params.epochDurationSeconds,
      runtime,
    );
  const commitHash = buildCommitHash(
    params.isUp,
    params.predictedUpBps,
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
    ciphertextHash,
    commitHash,
    targetRound,
    drandChainHash,
    roundReferenceRatingBps: params.roundReferenceRatingBps,
    commitKey: buildCommitKey(params.voter, commitHash),
  };
}

export async function createTlockRbtsVoteCommit(
  params: {
    voter: Address;
    isUp: boolean;
    predictedUpBps: number;
    salt: VoteSalt;
    contentId: bigint;
    roundId: bigint;
    roundReferenceRatingBps: number;
    epochDurationSeconds: number;
  },
  runtime: VoteTlockRuntime = {},
): Promise<{
  ciphertext: VoteCiphertext;
  ciphertextHash: `0x${string}`;
  commitHash: RbtsCommitHash;
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
  roundReferenceRatingBps: number;
  isUp: boolean;
  predictedUpBps: number;
  predictedUpPercent: number;
  commitKey: `0x${string}`;
}> {
  const predictedUpBps = normalizePredictedUpBps(params.predictedUpBps);
  const { ciphertext, ciphertextHash, targetRound, drandChainHash } =
    await createTlockVoteArtifacts(
      params.isUp,
      predictedUpBps,
      params.salt,
      params.epochDurationSeconds,
      runtime,
    );
  const commitHash = buildRbtsCommitHash(
    params.isUp,
    predictedUpBps,
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
    ciphertextHash,
    commitHash,
    targetRound,
    drandChainHash,
    roundReferenceRatingBps: params.roundReferenceRatingBps,
    isUp: params.isUp,
    predictedUpBps,
    predictedUpPercent: bpsToPredictionPercent(predictedUpBps),
    commitKey: buildCommitKey(params.voter, commitHash),
  };
}
