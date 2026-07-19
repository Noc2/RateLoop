import { createHash } from "node:crypto";
import { encodeAbiParameters, keccak256 } from "viem";
import { simulateManufacturedSurpriseFarming as simulateSurpriseFarming } from "./tokenlessSurpriseAttack.js";

export const BPS = 10_000;
export const MIN_USER_PREDICTION_BPS = 100;
export const MAX_USER_PREDICTION_BPS = 9_900;
export const TOKENLESS_RBTS_VERSION = "tokenless-rbts-v1-candidate";
export const SOLIDITY_SCORING_SEED_DOMAIN = "rateloop-tokenless-rbts-v1";
const UINT256_MODULUS = 1n << 256n;

function requireBps(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > BPS) {
    throw new TypeError(`${name} must be integer basis points between 0 and 10000.`);
  }
}

function requireVote(value, name) {
  if (value !== 0 && value !== 1) throw new TypeError(`${name} must be 0 or 1.`);
}

export function requireUserPrediction(value) {
  requireBps(value, "predictedUpBps");
  if (value < MIN_USER_PREDICTION_BPS || value > MAX_USER_PREDICTION_BPS || value % 100 !== 0) {
    throw new RangeError("predictedUpBps must be between 100 and 9900 on the 100-bps grid.");
  }
}

export function shadowPredictionBps(referencePredictionBps, ownVote) {
  requireBps(referencePredictionBps, "referencePredictionBps");
  requireVote(ownVote, "ownVote");
  const delta = Math.min(referencePredictionBps, BPS - referencePredictionBps);
  return ownVote === 1 ? referencePredictionBps + delta : referencePredictionBps - delta;
}

export function quadraticScoreBps(predictionBps, actualVote) {
  requireBps(predictionBps, "predictionBps");
  requireVote(actualVote, "actualVote");
  const squared = predictionBps * predictionBps;
  return actualVote === 1
    ? Math.floor((2 * BPS * predictionBps - squared) / BPS)
    : BPS - Math.floor(squared / BPS);
}

export function rbtsScoreBps({ ownVote, predictedUpBps, referencePredictionBps, peerVote }) {
  requireVote(ownVote, "ownVote");
  requireUserPrediction(predictedUpBps);
  requireBps(referencePredictionBps, "referencePredictionBps");
  requireVote(peerVote, "peerVote");
  const shadow = shadowPredictionBps(referencePredictionBps, ownVote);
  const informationScoreBps = quadraticScoreBps(shadow, peerVote);
  const predictionScoreBps = quadraticScoreBps(predictedUpBps, peerVote);
  return {
    shadowPredictionBps: shadow,
    informationScoreBps,
    predictionScoreBps,
    scoreBps: Math.floor((informationScoreBps + predictionScoreBps) / 2),
  };
}

function deterministicUint(seed, label) {
  const digest = createHash("sha256").update(`${seed}:${label}`).digest();
  return digest.readBigUInt64BE(0);
}

function deterministicUnit(seed, label) {
  return Number(deterministicUint(seed, label) >> 11n) / 9_007_199_254_740_992;
}

export function deterministicPermutation(length, seed) {
  if (!Number.isSafeInteger(length) || length < 0) throw new TypeError("length must be a non-negative integer.");
  const values = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index -= 1) {
    const swap = Number(deterministicUint(seed, `shuffle:${index}`) % BigInt(index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

export function peerAssignments(length, seed) {
  if (!Number.isSafeInteger(length) || length < 3) throw new RangeError("RBTS requires at least three reveals.");
  const permutation = deterministicPermutation(length, seed);
  const assignments = Array(length);
  for (let position = 0; position < length; position += 1) {
    const rater = permutation[position];
    assignments[rater] = {
      referenceIndex: permutation[(position + 1) % length],
      peerIndex: permutation[(position + 2) % length],
    };
  }
  return assignments;
}

export function scorePanel(reports, seed) {
  const assignments = peerAssignments(reports.length, seed);
  return reports.map((report, index) => {
    const assignment = assignments[index];
    const score = rbtsScoreBps({
      ownVote: report.vote,
      predictedUpBps: report.predictedUpBps,
      referencePredictionBps: reports[assignment.referenceIndex].predictedUpBps,
      peerVote: reports[assignment.peerIndex].vote,
    });
    return { index, ...assignment, ...score };
  });
}

export function accumulateSolidityRevealSet(commitKeys) {
  let revealSetXor = 0n;
  let revealSetSum = 0n;
  for (const commitKey of commitKeys) {
    const leaf = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }], [commitKey])));
    revealSetXor ^= leaf;
    revealSetSum = (revealSetSum + leaf) % UINT256_MODULUS;
  }
  return {
    revealSetXor: `0x${revealSetXor.toString(16).padStart(64, "0")}`,
    revealSetSum,
  };
}

export function solidityScoringSeed({
  chainId,
  panelAddress,
  roundId,
  frozenRevealCount,
  revealSetXor,
  revealSetSum,
  entropy,
}) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        SOLIDITY_SCORING_SEED_DOMAIN,
        BigInt(chainId),
        panelAddress,
        BigInt(roundId),
        frozenRevealCount,
        revealSetXor,
        BigInt(revealSetSum),
        entropy,
      ],
    ),
  );
}

export function solidityRankHash(seed, commitKey) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [seed, commitKey],
    ),
  );
}

export function canonicalSolidityPeerAssignments(seed, commitKeys) {
  if (commitKeys.length < 3 || new Set(commitKeys.map(key => key.toLowerCase())).size !== commitKeys.length) {
    throw new RangeError("RBTS requires at least three distinct commit keys.");
  }
  const ranked = commitKeys
    .map(commitKey => ({ commitKey, rankHash: solidityRankHash(seed, commitKey) }))
    .sort((left, right) => {
      const rankComparison = BigInt(left.rankHash) < BigInt(right.rankHash) ? -1 : BigInt(left.rankHash) > BigInt(right.rankHash) ? 1 : 0;
      if (rankComparison !== 0) return rankComparison;
      return BigInt(left.commitKey) < BigInt(right.commitKey) ? -1 : BigInt(left.commitKey) > BigInt(right.commitKey) ? 1 : 0;
    });
  return Object.fromEntries(
    ranked.map((entry, index) => [
      entry.commitKey,
      {
        referenceCommitKey: ranked[(index + 1) % ranked.length].commitKey,
        peerCommitKey: ranked[(index + 2) % ranked.length].commitKey,
      },
    ]),
  );
}

function nearestBucket(value) {
  const buckets = [1_000, 3_000, 5_000, 7_000, 9_000];
  return buckets.reduce((best, bucket) => (Math.abs(bucket - value) < Math.abs(best - value) ? bucket : best));
}

function draw(seed, label, probability) {
  return deterministicUnit(seed, label) < probability;
}

function honestReport(seed, trial, rater, trueVote, predictionMode = "continuous", priorShift = 0) {
  const signalCorrect = draw(seed, `${trial}:${rater}:signal`, 0.72);
  const signal = signalCorrect ? trueVote : 1 - trueVote;
  const calibrated = Math.max(100, Math.min(9_900, (signal === 1 ? 7_200 : 2_800) + priorShift));
  return {
    vote: signal,
    predictedUpBps: predictionMode === "bucket" ? nearestBucket(calibrated) : calibrated,
  };
}

function scenarioReports({ scenario, panelSize, seed, trial, trueVote }) {
  const reports = [];
  for (let rater = 0; rater < panelSize; rater += 1) {
    const honest = honestReport(seed, trial, rater, trueVote);
    if (scenario === "honest_continuous") reports.push(honest);
    else if (scenario === "honest_nearest_bucket") {
      reports.push(honestReport(seed, trial, rater, trueVote, "bucket"));
    } else if (scenario === "random_clicks") {
      reports.push({
        vote: draw(seed, `${trial}:${rater}:random-vote`, 0.5) ? 1 : 0,
        predictedUpBps: [1_000, 3_000, 5_000, 7_000, 9_000][
          Number(deterministicUint(seed, `${trial}:${rater}:random-prediction`) % 5n)
        ],
      });
    } else if (scenario === "unilateral_constant_up") {
      reports.push(rater === 0 ? { vote: 1, predictedUpBps: 9_000 } : honest);
    } else if (scenario === "constant_up") reports.push({ vote: 1, predictedUpBps: 9_000 });
    else if (scenario === "constant_down") reports.push({ vote: 0, predictedUpBps: 1_000 });
    else if (scenario === "coordinated_minority") {
      reports.push(rater < Math.ceil(panelSize * 0.25) ? { vote: 1 - trueVote, predictedUpBps: 7_000 } : honest);
    } else if (scenario === "coordinated_majority") {
      reports.push(rater < Math.ceil(panelSize * 0.6) ? { vote: 1, predictedUpBps: 9_000 } : honest);
    } else if (scenario === "selective_reveal") {
      if (honest.vote === 1 || draw(seed, `${trial}:${rater}:selective`, 0.35)) reports.push(honest);
    } else if (scenario === "heterogeneous_priors") {
      reports.push(honestReport(seed, trial, rater, trueVote, "continuous", rater % 2 === 0 ? -900 : 900));
    } else if (scenario === "seeded_correlation_ring") {
      reports.push(rater < Math.ceil(panelSize * 0.3) ? { vote: trueVote, predictedUpBps: trueVote ? 8_300 : 1_700 } : honest);
    } else throw new Error(`Unknown scenario: ${scenario}`);
  }
  return reports;
}

export const ATTACK_SCENARIOS = [
  "honest_continuous",
  "honest_nearest_bucket",
  "random_clicks",
  "unilateral_constant_up",
  "constant_up",
  "constant_down",
  "coordinated_minority",
  "coordinated_majority",
  "selective_reveal",
  "heterogeneous_priors",
  "seeded_correlation_ring",
];

export function simulateScenario({ scenario, trials = 2_000, panelSize = 15, seed = "rateloop-rbts-v1" }) {
  if (!ATTACK_SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  let scoreTotal = 0;
  let reportCount = 0;
  let correctVotes = 0;
  let upVotes = 0;
  let skippedTrials = 0;
  let focalScoreTotal = 0;
  let focalCorrectVotes = 0;
  let populationScoreTotal = 0;
  let populationCorrectVotes = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const trueVote = draw(seed, `${trial}:truth`, 0.5) ? 1 : 0;
    const reports = scenarioReports({ scenario, panelSize, seed, trial, trueVote });
    if (reports.length < 3) {
      skippedTrials += 1;
      continue;
    }
    const scores = scorePanel(reports, `${seed}:${scenario}:${trial}`);
    scoreTotal += scores.reduce((sum, score) => sum + score.scoreBps, 0);
    reportCount += reports.length;
    correctVotes += reports.filter(report => report.vote === trueVote).length;
    upVotes += reports.filter(report => report.vote === 1).length;
    if (scenario === "unilateral_constant_up") {
      focalScoreTotal += scores[0].scoreBps;
      focalCorrectVotes += reports[0].vote === trueVote ? 1 : 0;
      populationScoreTotal += scores.slice(1).reduce((sum, score) => sum + score.scoreBps, 0);
      populationCorrectVotes += reports.slice(1).filter(report => report.vote === trueVote).length;
    }
  }
  const completedTrials = trials - skippedTrials;
  const result = {
    scenario,
    trials,
    panelSize,
    completedTrials,
    reportCount,
    meanScoreBps: reportCount === 0 ? 0 : Math.round(scoreTotal / reportCount),
    correctVoteBps: reportCount === 0 ? 0 : Math.round((correctVotes * BPS) / reportCount),
    upVoteBps: reportCount === 0 ? 0 : Math.round((upVotes * BPS) / reportCount),
  };
  if (scenario !== "unilateral_constant_up") return result;
  const populationReportCount = completedTrials * (panelSize - 1);
  const focalReporterMeanScoreBps = completedTrials === 0 ? 0 : Math.round(focalScoreTotal / completedTrials);
  const honestPopulationMeanScoreBps =
    populationReportCount === 0 ? 0 : Math.round(populationScoreTotal / populationReportCount);
  return {
    ...result,
    focalReporterMeanScoreBps,
    focalReporterCorrectVoteBps:
      completedTrials === 0 ? 0 : Math.round((focalCorrectVotes * BPS) / completedTrials),
    honestPopulationMeanScoreBps,
    honestPopulationCorrectVoteBps:
      populationReportCount === 0 ? 0 : Math.round((populationCorrectVotes * BPS) / populationReportCount),
    honestResponsePremiumBps: honestPopulationMeanScoreBps - focalReporterMeanScoreBps,
  };
}

export function simulateManufacturedSurpriseFarming(options = {}) {
  return simulateSurpriseFarming({ ...options, scorePanel });
}

export function benchmarkAllScenarios(options = {}) {
  return {
    schema: "rateloop-rbts-attack-benchmark-v1",
    mechanismVersion: TOKENLESS_RBTS_VERSION,
    seed: options.seed ?? "rateloop-rbts-v1",
    trials: options.trials ?? 2_000,
    panelSize: options.panelSize ?? 15,
    results: ATTACK_SCENARIOS.map(scenario => simulateScenario({ ...options, scenario })),
    surpriseBountyDiagnostics: simulateManufacturedSurpriseFarming(options),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(benchmarkAllScenarios(), null, 2)}\n`);
}
