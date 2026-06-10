import { readFile } from "node:fs/promises";
import {
  correlationParameterHash,
  defaultCorrelationScoringParams,
  merkleProof,
  scoreRoundPayoutWeights,
  type CorrelationScoringParams,
  type CorrelationVoteInput,
} from "@rateloop/node-utils/correlationScoring";
import { canonicalJsonHash } from "@rateloop/node-utils/json";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

interface VerificationResult {
  ok: boolean;
  artifactHash: Hex;
  parameterHash: Hex | null;
  roundSnapshotCount: number;
  epochCount: number;
  errors: string[];
}

interface PublicCorrelationArtifact {
  chainId?: unknown;
  oracleAddress?: unknown;
  parameters?: Partial<CorrelationScoringParams>;
  correlationEpochs?: unknown[];
  roundPayoutSnapshots?: unknown[];
}

interface NormalizedRoundSnapshot {
  domain: number;
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
  correlationEpochId: bigint;
  rawEligibleVoters: number;
  effectiveParticipantUnits: number;
  totalClaimWeight: bigint;
  weightRoot: Hex;
  reasonRoot: Hex;
  trailingBaseRateUpBps: number | null;
  eligibleVotes: CorrelationVoteInput[];
  payoutWeights: NormalizedPayoutWeight[];
}

interface NormalizedPayoutWeight {
  domain: number;
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
  commitKey: Hex;
  identityKey: Hex;
  account: Address;
  baseWeight: bigint;
  independenceBps: number;
  effectiveWeight: bigint;
  surpriseBps: number;
  reasonHash: Hex;
  leaf: Hex;
  proof: Hex[];
}

export async function verifyCorrelationArtifactFile(
  path: string,
): Promise<VerificationResult> {
  return verifyCorrelationArtifactJson(await readFile(path, "utf8"));
}

export function verifyCorrelationArtifactJson(json: string): VerificationResult {
  return verifyCorrelationArtifact(JSON.parse(json));
}

export function verifyCorrelationArtifact(
  artifact: unknown,
): VerificationResult {
  const errors: string[] = [];
  const artifactHash = canonicalJsonHash(artifact);
  const record = requireRecord(artifact, "artifact", errors) as PublicCorrelationArtifact | null;
  if (!record) {
    return emptyResult(artifactHash, errors);
  }

  const chainId = readPositiveBigInt(record.chainId, "chainId", errors);
  const oracleAddress = readAddress(record.oracleAddress, "oracleAddress", errors);
  const params = readScoringParams(record.parameters, errors);
  const parameterHash = params ? correlationParameterHash(params) : null;
  const rounds = readArray(record.roundPayoutSnapshots, "roundPayoutSnapshots", errors)
    .map((value, index) => readRoundSnapshot(value, index, errors))
    .filter((round): round is NormalizedRoundSnapshot => round !== null);

  if (chainId !== null && oracleAddress && params) {
    for (const round of rounds) {
      verifyRoundSnapshot(round, chainId, oracleAddress, params, errors);
    }
  }

  const epochs = readArray(record.correlationEpochs, "correlationEpochs", errors);
  if (parameterHash) {
    verifyEpochs(epochs, rounds, parameterHash, errors);
  }

  return {
    ok: errors.length === 0,
    artifactHash,
    parameterHash,
    roundSnapshotCount: rounds.length,
    epochCount: epochs.length,
    errors,
  };
}

function emptyResult(artifactHash: Hex, errors: string[]): VerificationResult {
  return {
    ok: false,
    artifactHash,
    parameterHash: null,
    roundSnapshotCount: 0,
    epochCount: 0,
    errors,
  };
}

function readScoringParams(
  value: unknown,
  errors: string[],
): CorrelationScoringParams | null {
  const record = requireRecord(value, "parameters", errors);
  if (!record) return null;
  const params = {
    ...defaultCorrelationScoringParams(),
    ...record,
  } as CorrelationScoringParams;
  try {
    correlationParameterHash(params);
    return params;
  } catch (error) {
    errors.push(`parameters: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function readRoundSnapshot(
  value: unknown,
  index: number,
  errors: string[],
): NormalizedRoundSnapshot | null {
  const label = `roundPayoutSnapshots[${index}]`;
  const record = requireRecord(value, label, errors);
  if (!record) return null;

  const eligibleVotes = readArray(record.eligibleVotes, `${label}.eligibleVotes`, errors)
    .map((entry, voteIndex) => readEligibleVote(entry, `${label}.eligibleVotes[${voteIndex}]`, errors))
    .filter((vote): vote is CorrelationVoteInput => vote !== null);
  const payoutWeights = readArray(record.payoutWeights, `${label}.payoutWeights`, errors)
    .map((entry, weightIndex) => readPayoutWeight(entry, `${label}.payoutWeights[${weightIndex}]`, errors))
    .filter((weight): weight is NormalizedPayoutWeight => weight !== null);

  const domain = readNonNegativeInteger(record.domain, `${label}.domain`, errors);
  const rewardPoolId = readPositiveBigInt(record.rewardPoolId, `${label}.rewardPoolId`, errors);
  const contentId = readPositiveBigInt(record.contentId, `${label}.contentId`, errors);
  const roundId = readPositiveBigInt(record.roundId, `${label}.roundId`, errors);
  const correlationEpochId = readPositiveBigInt(record.correlationEpochId, `${label}.correlationEpochId`, errors);
  const rawEligibleVoters = readNonNegativeInteger(record.rawEligibleVoters, `${label}.rawEligibleVoters`, errors);
  const effectiveParticipantUnits = readNonNegativeInteger(record.effectiveParticipantUnits, `${label}.effectiveParticipantUnits`, errors);
  const totalClaimWeight = readNonNegativeBigInt(record.totalClaimWeight, `${label}.totalClaimWeight`, errors);
  const weightRoot = readHex(record.weightRoot, `${label}.weightRoot`, 32, errors);
  const reasonRoot = readHex(record.reasonRoot, `${label}.reasonRoot`, 32, errors);
  const trailingBaseRateUpBps = readTrailingBaseRateUpBps(
    record.trailingBaseRateUpBps,
    `${label}.trailingBaseRateUpBps`,
    errors,
  );

  if (
    domain === null ||
    rewardPoolId === null ||
    contentId === null ||
    roundId === null ||
    correlationEpochId === null ||
    rawEligibleVoters === null ||
    effectiveParticipantUnits === null ||
    totalClaimWeight === null ||
    !weightRoot ||
    !reasonRoot
  ) {
    return null;
  }

  return {
    domain,
    rewardPoolId,
    contentId,
    roundId,
    correlationEpochId,
    rawEligibleVoters,
    effectiveParticipantUnits,
    totalClaimWeight,
    weightRoot,
    reasonRoot,
    trailingBaseRateUpBps,
    eligibleVotes,
    payoutWeights,
  };
}

function readTrailingBaseRateUpBps(
  value: unknown,
  label: string,
  errors: string[],
): number | null {
  if (value === undefined || value === null) return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
    errors.push(`${label} must be null or an integer between 0 and 10000`);
    return null;
  }
  return parsed;
}

function readEligibleVote(
  value: unknown,
  label: string,
  errors: string[],
): CorrelationVoteInput | null {
  const record = requireRecord(value, label, errors);
  if (!record) return null;
  const account = readAddress(record.account, `${label}.account`, errors);
  const identityKey = readHex(record.identityKey, `${label}.identityKey`, 32, errors);
  const commitKey = readHex(record.commitKey, `${label}.commitKey`, 32, errors);
  const historicalVoteCount = readNonNegativeInteger(record.historicalVoteCount, `${label}.historicalVoteCount`, errors);
  const features = readArray(record.features, `${label}.features`, errors).filter(
    (feature): feature is string => typeof feature === "string",
  );
  const revealWeight =
    record.revealWeight === undefined || record.revealWeight === null
      ? null
      : readNonNegativeBigInt(record.revealWeight, `${label}.revealWeight`, errors);
  if (!account || !identityKey || !commitKey || historicalVoteCount === null) {
    return null;
  }
  return {
    account,
    identityKey,
    commitKey,
    verifiedHuman: record.verifiedHuman === true,
    historicalVoteCount,
    features,
    isUp: typeof record.isUp === "boolean" ? record.isUp : null,
    revealWeight,
  };
}

function readPayoutWeight(
  value: unknown,
  label: string,
  errors: string[],
): NormalizedPayoutWeight | null {
  const record = requireRecord(value, label, errors);
  if (!record) return null;
  const domain = readNonNegativeInteger(record.domain, `${label}.domain`, errors);
  const rewardPoolId = readPositiveBigInt(record.rewardPoolId, `${label}.rewardPoolId`, errors);
  const contentId = readPositiveBigInt(record.contentId, `${label}.contentId`, errors);
  const roundId = readPositiveBigInt(record.roundId, `${label}.roundId`, errors);
  const commitKey = readHex(record.commitKey, `${label}.commitKey`, 32, errors);
  const identityKey = readHex(record.identityKey, `${label}.identityKey`, 32, errors);
  const account = readAddress(record.account, `${label}.account`, errors);
  const baseWeight = readPositiveBigInt(record.baseWeight, `${label}.baseWeight`, errors);
  const independenceBps = readNonNegativeInteger(record.independenceBps, `${label}.independenceBps`, errors);
  const effectiveWeight = readNonNegativeBigInt(record.effectiveWeight, `${label}.effectiveWeight`, errors);
  const surpriseBps = readNonNegativeInteger(record.surpriseBps, `${label}.surpriseBps`, errors);
  const reasonHash = readHex(record.reasonHash, `${label}.reasonHash`, 32, errors);
  const leaf = readHex(record.leaf, `${label}.leaf`, 32, errors);
  const proof = readArray(record.proof, `${label}.proof`, errors)
    .map((entry, proofIndex) => readHex(entry, `${label}.proof[${proofIndex}]`, 32, errors))
    .filter((entry): entry is Hex => entry !== null);

  if (
    domain === null ||
    rewardPoolId === null ||
    contentId === null ||
    roundId === null ||
    !commitKey ||
    !identityKey ||
    !account ||
    baseWeight === null ||
    independenceBps === null ||
    effectiveWeight === null ||
    surpriseBps === null ||
    !reasonHash ||
    !leaf
  ) {
    return null;
  }
  return {
    domain,
    rewardPoolId,
    contentId,
    roundId,
    commitKey,
    identityKey,
    account,
    baseWeight,
    independenceBps,
    effectiveWeight,
    surpriseBps,
    reasonHash,
    leaf,
    proof,
  };
}

function verifyRoundSnapshot(
  round: NormalizedRoundSnapshot,
  chainId: bigint,
  oracleAddress: Address,
  params: CorrelationScoringParams,
  errors: string[],
) {
  const label = `round ${round.contentId.toString()}/${round.roundId.toString()}`;
  let scored: ReturnType<typeof scoreRoundPayoutWeights>;
  try {
    scored = scoreRoundPayoutWeights({
      chainId,
      oracleAddress,
      domain: round.domain,
      rewardPoolId: round.rewardPoolId,
      contentId: round.contentId,
      roundId: round.roundId,
      votes: round.eligibleVotes,
      trailingBaseRateUpBps: round.trailingBaseRateUpBps,
      params,
    });
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  compareValue(label, "rawEligibleVoters", round.rawEligibleVoters, scored.rawEligibleVoters, errors);
  compareValue(label, "effectiveParticipantUnits", round.effectiveParticipantUnits, scored.effectiveParticipantUnits, errors);
  compareValue(label, "totalClaimWeight", round.totalClaimWeight.toString(), scored.totalClaimWeight.toString(), errors);
  compareValue(label, "weightRoot", round.weightRoot.toLowerCase(), scored.weightRoot.toLowerCase(), errors);
  compareValue(label, "reasonRoot", round.reasonRoot.toLowerCase(), scored.reasonRoot.toLowerCase(), errors);

  const expectedByKey = new Map(
    scored.leaves.map((leaf) => [payoutKey(leaf.commitKey, leaf.identityKey), leaf]),
  );
  const leaves = scored.leaves.map((leaf) => leaf.leaf);
  for (const actual of round.payoutWeights) {
    const expected = expectedByKey.get(payoutKey(actual.commitKey, actual.identityKey));
    if (!expected) {
      errors.push(`${label}: unexpected payout weight ${actual.commitKey}/${actual.identityKey}`);
      continue;
    }
    compareValue(label, "leaf", actual.leaf.toLowerCase(), expected.leaf.toLowerCase(), errors);
    compareValue(label, "baseWeight", actual.baseWeight.toString(), expected.baseWeight.toString(), errors);
    compareValue(label, "independenceBps", actual.independenceBps, expected.independenceBps, errors);
    compareValue(label, "effectiveWeight", actual.effectiveWeight.toString(), expected.effectiveWeight.toString(), errors);
    compareValue(label, "surpriseBps", actual.surpriseBps, expected.surpriseBps, errors);
    compareValue(label, "reasonHash", actual.reasonHash.toLowerCase(), expected.reasonHash.toLowerCase(), errors);
    const expectedProof = merkleProof(leaves, expected.leaf).map((entry) => entry.toLowerCase());
    const actualProof = actual.proof.map((entry) => entry.toLowerCase());
    if (JSON.stringify(actualProof) !== JSON.stringify(expectedProof)) {
      errors.push(`${label}: Merkle proof mismatch for ${actual.commitKey}/${actual.identityKey}`);
    }
  }
  if (round.payoutWeights.length !== scored.leaves.length) {
    errors.push(`${label}: payoutWeights length ${round.payoutWeights.length} != ${scored.leaves.length}`);
  }
}

function verifyEpochs(
  epochs: unknown[],
  rounds: NormalizedRoundSnapshot[],
  parameterHash: Hex,
  errors: string[],
) {
  for (let index = 0; index < epochs.length; index += 1) {
    const label = `correlationEpochs[${index}]`;
    const epoch = requireRecord(epochs[index], label, errors);
    if (!epoch) continue;
    const epochId = readPositiveBigInt(epoch.epochId, `${label}.epochId`, errors);
    const clusterRoot = readHex(epoch.clusterRoot, `${label}.clusterRoot`, 32, errors);
    const epochParameterHash = readHex(epoch.parameterHash, `${label}.parameterHash`, 32, errors);
    if (epochId === null || !clusterRoot || !epochParameterHash) continue;
    compareValue(label, "parameterHash", epochParameterHash.toLowerCase(), parameterHash.toLowerCase(), errors);
    const epochRounds = rounds.filter((round) => round.correlationEpochId === epochId);
    const expectedClusterRoot = hashJson(
      epochRounds.map((round) => ({
        rewardPoolId: round.rewardPoolId.toString(),
        contentId: round.contentId.toString(),
        roundId: round.roundId.toString(),
        weightRoot: round.weightRoot,
        reasonRoot: round.reasonRoot,
      })),
    );
    compareValue(label, "clusterRoot", clusterRoot.toLowerCase(), expectedClusterRoot.toLowerCase(), errors);
  }
}

function compareValue(
  label: string,
  field: string,
  actual: unknown,
  expected: unknown,
  errors: string[],
) {
  if (actual !== expected) {
    errors.push(`${label}: ${field} ${String(actual)} != ${String(expected)}`);
  }
}

function payoutKey(commitKey: Hex, identityKey: Hex) {
  return `${commitKey.toLowerCase()}:${identityKey.toLowerCase()}`;
}

function hashJson(value: unknown): Hex {
  return canonicalJsonHash(value);
}

function requireRecord(
  value: unknown,
  label: string,
  errors: string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  return value as Record<string, unknown>;
}

function readArray(value: unknown, label: string, errors: string[]): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  return value;
}

function readAddress(
  value: unknown,
  label: string,
  errors: string[],
): Address | null {
  if (typeof value !== "string" || !isAddress(value)) {
    errors.push(`${label} must be an address`);
    return null;
  }
  return getAddress(value);
}

function readHex(
  value: unknown,
  label: string,
  bytes: number,
  errors: string[],
): Hex | null {
  if (typeof value !== "string" || !isHex(value) || value.length !== 2 + bytes * 2) {
    errors.push(`${label} must be ${bytes}-byte hex`);
    return null;
  }
  return value as Hex;
}

function readPositiveBigInt(
  value: unknown,
  label: string,
  errors: string[],
): bigint | null {
  const parsed = parseBigIntLike(value);
  if (parsed === null || parsed <= 0n) {
    errors.push(`${label} must be a positive integer`);
    return null;
  }
  return parsed;
}

function readNonNegativeBigInt(
  value: unknown,
  label: string,
  errors: string[],
): bigint | null {
  const parsed = parseBigIntLike(value);
  if (parsed === null || parsed < 0n) {
    errors.push(`${label} must be a non-negative integer`);
    return null;
  }
  return parsed;
}

function readNonNegativeInteger(
  value: unknown,
  label: string,
  errors: string[],
): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    errors.push(`${label} must be a non-negative integer`);
    return null;
  }
  return parsed;
}

function parseBigIntLike(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactPath = process.argv[2];
  if (!artifactPath) {
    console.error("Usage: tsx src/correlation-artifact-verifier.ts <artifact.json>");
    process.exit(1);
  }
  verifyCorrelationArtifactFile(artifactPath)
    .then((result) => {
      if (!result.ok) {
        console.error(JSON.stringify(result, null, 2));
        process.exit(1);
      }
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
