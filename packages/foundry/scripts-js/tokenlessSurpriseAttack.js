const BPS = 10_000;
const SEAT_PAY_ATOMIC = 1_000_000n;
const FIXED_BASE_BPS = 8_000;
const DEFAULT_FEE_BPS = 750;
const SURPRISE_FORMULA_CAP_OF_BASE_BPS = 1_250;
const SURPRISE_THRESHOLD_BPS = 500;
const SURPRISE_SATURATION_BPS = 2_500;

function surpriseAllocation(reports, roundFeeAtomic) {
  const panelSize = reports.length;
  const guaranteedBasePerReportAtomic = (SEAT_PAY_ATOMIC * BigInt(FIXED_BASE_BPS)) / BigInt(BPS);
  const formulaCapPerReportAtomic =
    (guaranteedBasePerReportAtomic * BigInt(SURPRISE_FORMULA_CAP_OF_BASE_BPS)) / BigInt(BPS);
  const feeCapPerReportAtomic = roundFeeAtomic / BigInt(panelSize);
  const maximumBonusPerReportAtomic =
    formulaCapPerReportAtomic < feeCapPerReportAtomic ? formulaCapPerReportAtomic : feeCapPerReportAtomic;
  const upVotes = reports.reduce((sum, report) => sum + report.vote, 0);
  const unanimous = upVotes === 0 || upVotes === panelSize;
  const predictedUpSum = reports.reduce((sum, report) => sum + report.predictedUpBps, 0);
  const actualUpBps = Math.floor((upVotes * BPS) / panelSize);
  const aggregateMarginUpBps = actualUpBps - Math.floor(predictedUpSum / panelSize);
  const selectedOutcome =
    Math.abs(aggregateMarginUpBps) < SURPRISE_THRESHOLD_BPS ? null : aggregateMarginUpBps > 0 ? 1 : 0;
  const bonuses = reports.map(report => {
    if (unanimous || report.vote !== selectedOutcome) return 0n;
    const peerCount = panelSize - 1;
    const actualUpWithoutReportBps = Math.floor(((upVotes - report.vote) * BPS) / peerCount);
    const predictedUpWithoutReportBps = Math.floor((predictedUpSum - report.predictedUpBps) / peerCount);
    const actualSideBps = report.vote === 1 ? actualUpWithoutReportBps : BPS - actualUpWithoutReportBps;
    const predictedSideBps = report.vote === 1 ? predictedUpWithoutReportBps : BPS - predictedUpWithoutReportBps;
    const marginBps = actualSideBps - predictedSideBps;
    if (marginBps < SURPRISE_THRESHOLD_BPS) return 0n;
    const scoreBps = Math.min(BPS, Math.floor((marginBps * BPS) / SURPRISE_SATURATION_BPS));
    return (maximumBonusPerReportAtomic * BigInt(scoreBps)) / BigInt(BPS);
  });
  return {
    unanimous,
    maximumBonusPerReportAtomic,
    maximumRoundLiabilityAtomic: maximumBonusPerReportAtomic * BigInt(panelSize),
    totalBonusAtomic: bonuses.reduce((sum, bonus) => sum + bonus, 0n),
    bonuses,
  };
}

export function simulateManufacturedSurpriseFarming({
  scorePanel,
  trials = 2_000,
  panelSize = 15,
  seed = "rateloop-rbts-v1",
} = {}) {
  if (typeof scorePanel !== "function") throw new TypeError("scorePanel is required.");
  if (!Number.isSafeInteger(trials) || trials <= 0) throw new RangeError("trials must be a positive integer.");
  if (!Number.isSafeInteger(panelSize) || panelSize < 10) {
    throw new RangeError("manufactured-surprise diagnostics require at least ten reports.");
  }
  const coalitionSize = panelSize - 1;
  const baselineReports = Array.from({ length: panelSize }, () => ({ vote: 1, predictedUpBps: 9_000 }));
  const unanimousReports = Array.from({ length: panelSize }, () => ({ vote: 1, predictedUpBps: 3_000 }));
  const nearUnanimousReports = Array.from({ length: panelSize }, (_, index) => ({
    vote: index < coalitionSize ? 1 : 0,
    predictedUpBps: 3_000,
  }));
  const roundFeeAtomic = (SEAT_PAY_ATOMIC * BigInt(panelSize) * BigInt(DEFAULT_FEE_BPS)) / BigInt(BPS);
  const unanimousAllocation = surpriseAllocation(unanimousReports, roundFeeAtomic);
  const nearUnanimousAllocation = surpriseAllocation(nearUnanimousReports, roundFeeAtomic);
  let baselineScoreTotal = 0;
  let unanimousScoreTotal = 0;
  let coalitionScoreTotal = 0;
  let dissenterScoreTotal = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    baselineScoreTotal += scorePanel(baselineReports, `${seed}:sp-baseline:${trial}`).reduce(
      (sum, score) => sum + score.scoreBps,
      0,
    );
    unanimousScoreTotal += scorePanel(unanimousReports, `${seed}:sp-unanimous:${trial}`).reduce(
      (sum, score) => sum + score.scoreBps,
      0,
    );
    const nearUnanimousScores = scorePanel(nearUnanimousReports, `${seed}:sp-farming:${trial}`);
    coalitionScoreTotal += nearUnanimousScores
      .slice(0, coalitionSize)
      .reduce((sum, score) => sum + score.scoreBps, 0);
    dissenterScoreTotal += nearUnanimousScores[coalitionSize].scoreBps;
  }
  const baselineMeanRbtsScoreBps = Math.round(baselineScoreTotal / (trials * panelSize));
  const unanimousMeanRbtsScoreBps = Math.round(unanimousScoreTotal / (trials * panelSize));
  const coalitionMeanRbtsScoreBps = Math.round(coalitionScoreTotal / (trials * coalitionSize));
  const maximumRbtsBonusBps = BPS - FIXED_BASE_BPS;
  const rbtsSeatPayDelta = meanScoreBps =>
    Math.round(((meanScoreBps - baselineMeanRbtsScoreBps) * maximumRbtsBonusBps) / BPS);
  const coalitionRbtsSeatPayDeltaBps = rbtsSeatPayDelta(coalitionMeanRbtsScoreBps);
  const coalitionSurpriseSeatPayBps = Number(
    (nearUnanimousAllocation.bonuses[0] * BigInt(BPS)) / SEAT_PAY_ATOMIC,
  );
  return {
    scenario: "manufactured_surprise_sp_farming",
    trials,
    panelSize,
    coalitionSize,
    seatPayAtomic: SEAT_PAY_ATOMIC.toString(),
    guaranteedBasePerReportAtomic: ((SEAT_PAY_ATOMIC * BigInt(FIXED_BASE_BPS)) / BigInt(BPS)).toString(),
    roundFeeAtomic: roundFeeAtomic.toString(),
    maximumBonusPerReportAtomic: nearUnanimousAllocation.maximumBonusPerReportAtomic.toString(),
    maximumRoundLiabilityAtomic: nearUnanimousAllocation.maximumRoundLiabilityAtomic.toString(),
    baselineCollusiveMeanRbtsScoreBps: baselineMeanRbtsScoreBps,
    unanimousControl: {
      meanRbtsScoreBps: unanimousMeanRbtsScoreBps,
      rbtsSeatPayDeltaBps: rbtsSeatPayDelta(unanimousMeanRbtsScoreBps),
      totalSurpriseBonusAtomic: unanimousAllocation.totalBonusAtomic.toString(),
      unanimityDisqualified: unanimousAllocation.unanimous,
    },
    nearUnanimousAttack: {
      coalitionMeanRbtsScoreBps,
      dissenterMeanRbtsScoreBps: Math.round(dissenterScoreTotal / trials),
      coalitionRbtsSeatPayDeltaBps,
      coalitionSurpriseSeatPayBps,
      coalitionNetSeatPayDeltaBps: coalitionRbtsSeatPayDeltaBps + coalitionSurpriseSeatPayBps,
      totalSurpriseBonusAtomic: nearUnanimousAllocation.totalBonusAtomic.toString(),
      surpriseOutlayWithinRoundFee:
        nearUnanimousAllocation.totalBonusAtomic <= roundFeeAtomic &&
        nearUnanimousAllocation.maximumRoundLiabilityAtomic <= roundFeeAtomic,
    },
  };
}
