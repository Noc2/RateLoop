import { describe, expect, it } from "vitest";
import {
  tokenlessCommit,
  tokenlessFeedbackBonusPool,
  tokenlessFeedbackRecord,
  tokenlessRound,
} from "../ponder.schema";
import {
  tokenlessFeedbackBonusAbi,
  tokenlessPanelAbi,
} from "../src/tokenlessAbi";

describe("tokenless panel indexing ABI", () => {
  it("includes the complete pull-credit evidence surface", () => {
    const events = new Set(
      tokenlessPanelAbi
        .filter((entry) => entry.type === "event")
        .map((entry) => entry.name),
    );
    const functions = new Set(
      tokenlessPanelAbi
        .filter((entry) => entry.type === "function")
        .map((entry) => entry.name),
    );

    expect(events).toContain("CreditAccrued");
    expect(events).toContain("CreditWithdrawn");
    expect(functions).toContain("withdrawableCredit");
  });

  it("decodes the exact v4 RBTS creation and settlement evidence", () => {
    const roundCreated = tokenlessPanelAbi.find(
      (entry) => entry.type === "event" && entry.name === "RoundCreated",
    );
    const getRound = tokenlessPanelAbi.find(
      (entry) => entry.type === "function" && entry.name === "getRound",
    );
    const settlementBegun = tokenlessPanelAbi.find(
      (entry) => entry.type === "event" && entry.name === "SettlementBegun",
    );
    const scoringSeedFinalized = tokenlessPanelAbi.find(
      (entry) =>
        entry.type === "event" && entry.name === "ScoringSeedFinalized",
    );

    expect(
      roundCreated?.inputs.map(({ name, type, indexed }) => ({
        name,
        type,
        indexed,
      })),
    ).toEqual([
      { name: "roundId", type: "uint256", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "contentId", type: "bytes32", indexed: true },
      { name: "termsHash", type: "bytes32", indexed: false },
      { name: "admissionPolicyHash", type: "bytes32", indexed: false },
      { name: "bountyAmount", type: "uint256", indexed: false },
      { name: "feeAmount", type: "uint256", indexed: false },
      { name: "attemptReserve", type: "uint256", indexed: false },
      { name: "fixedBasePay", type: "uint256", indexed: false },
      { name: "maximumBonus", type: "uint256", indexed: false },
      { name: "scoringVersion", type: "uint8", indexed: false },
    ]);
    expect(
      getRound?.outputs[0]?.components.map(({ name, type }) => ({
        name,
        type,
      })),
    ).toEqual([
      { name: "funder", type: "address" },
      { name: "contentId", type: "bytes32" },
      { name: "termsHash", type: "bytes32" },
      { name: "beaconNetworkHash", type: "bytes32" },
      { name: "feeRecipient", type: "address" },
      { name: "bountyAmount", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "attemptReserve", type: "uint256" },
      { name: "attemptCompensation", type: "uint256" },
      { name: "fixedBasePay", type: "uint256" },
      { name: "maximumBonus", type: "uint256" },
      { name: "compensationPerRecipient", type: "uint256" },
      { name: "totalRbtsScoreBps", type: "uint256" },
      { name: "totalFinalizedLiability", type: "uint256" },
      { name: "totalPaid", type: "uint256" },
      { name: "revealSetXor", type: "bytes32" },
      { name: "revealSetSum", type: "uint256" },
      { name: "scoringSeed", type: "bytes32" },
      { name: "beaconEntropy", type: "bytes32" },
      { name: "commitDeadline", type: "uint64" },
      { name: "revealDeadline", type: "uint64" },
      { name: "beaconFailureDeadline", type: "uint64" },
      { name: "beaconRound", type: "uint64" },
      { name: "scoringBeaconRound", type: "uint64" },
      { name: "claimGracePeriod", type: "uint64" },
      { name: "claimDeadline", type: "uint256" },
      { name: "minimumReveals", type: "uint32" },
      { name: "maximumCommits", type: "uint32" },
      { name: "admissionPolicyHash", type: "bytes32" },
      { name: "commitCount", type: "uint32" },
      { name: "revealCount", type: "uint32" },
      { name: "compensatedRevealCount", type: "uint32" },
      { name: "frozenRevealCount", type: "uint32" },
      { name: "aggregateCursor", type: "uint32" },
      { name: "scoreCursor", type: "uint32" },
      { name: "upVotes", type: "uint32" },
      { name: "state", type: "uint8" },
      { name: "scoringMode", type: "uint8" },
      { name: "staleReturned", type: "bool" },
    ]);
    expect(
      getRound?.outputs[0]?.components.some(
        (component) => component.name === "totalAccuracyScore",
      ),
    ).toBe(false);
    expect(settlementBegun?.inputs[2]?.name).toBe("scoringBeaconRound");
    expect(scoringSeedFinalized?.inputs[2]?.name).toBe("scoringBeaconRound");
    expect(
      getRound?.outputs[0]?.components.some(
        (component) => component.name === "requiredTier",
      ),
    ).toBe(false);
  });

  it("indexes all feedback bonus lifecycle events without feedback contents", () => {
    const events = new Set(
      tokenlessFeedbackBonusAbi
        .filter((entry) => entry.type === "event")
        .map((entry) => entry.name),
    );
    expect(events).toEqual(
      new Set([
        "PoolCreated",
        "FeedbackRegistered",
        "FeedbackAwarded",
        "FeedbackAwardClaimed",
        "RemainderRefunded",
      ]),
    );
    expect(tokenlessFeedbackBonusPool.deploymentKey.columnType).toBe("PgText");
    expect(tokenlessFeedbackBonusPool.awardedAmount.columnType).toBe(
      "PgEvmBigint",
    );
    expect(tokenlessFeedbackRecord.claimed.columnType).toBe("PgBoolean");
  });

  it("stores public RBTS evidence without retaining v0 weighting columns", () => {
    expect(tokenlessRound.admissionPolicyHash.columnType).toBe("PgHex");
    expect(tokenlessRound.finalizedAt.columnType).toBe("PgEvmBigint");
    expect(tokenlessRound.finalizedBlock.columnType).toBe("PgEvmBigint");
    expect(tokenlessRound.finalizedBlockHash.columnType).toBe("PgHex");
    expect(tokenlessRound.finalizedTxHash.columnType).toBe("PgHex");
    expect(tokenlessRound.scoringSeed.columnType).toBe("PgHex");
    expect(tokenlessRound.entropy.columnType).toBe("PgHex");
    expect(tokenlessRound.totalFinalizedLiability.columnType).toBe(
      "PgEvmBigint",
    );
    expect(tokenlessCommit.scoringEligible.columnType).toBe("PgBoolean");
    expect("totalAccuracyScore" in tokenlessRound).toBe(false);
    expect("weightCursor" in tokenlessRound).toBe(false);
    expect("requiredTier" in tokenlessRound).toBe(false);
  });

  it("indexes the seed, per-reveal score, and fixed liability events", () => {
    const eventNames = new Set(
      tokenlessPanelAbi
        .filter((entry) => entry.type === "event")
        .map((entry) => entry.name),
    );
    expect(eventNames).toContain("ScoringSeedFinalized");
    expect(eventNames).toContain("RevealScored");
    const revealAccepted = tokenlessPanelAbi.find(
      (entry) => entry.type === "event" && entry.name === "RevealAccepted",
    );
    expect(revealAccepted?.inputs.map((input) => input.name)).toEqual([
      "roundId",
      "commitKey",
      "vote",
      "predictedUpBps",
      "responseHash",
      "scoringEligible",
    ]);
    const finalized = tokenlessPanelAbi.find(
      (entry) => entry.type === "event" && entry.name === "RoundFinalized",
    );
    expect(finalized?.inputs.map((input) => input.name)).toEqual([
      "roundId",
      "mode",
      "totalRbtsScoreBps",
      "totalFinalizedLiability",
      "funderRefund",
      "claimDeadline",
    ]);
  });
});
