import { describe, expect, it } from "vitest";
import {
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
    expect(getRound?.outputs[0]?.components).toContainEqual({
      name: "admissionPolicyHash",
      type: "bytes32",
    });
    expect(getRound?.outputs[0]?.components).toContainEqual({
      name: "claimDeadline",
      type: "uint256",
    });
    expect(getRound?.outputs[0]?.components).toContainEqual({
      name: "scoringSeed",
      type: "bytes32",
    });
    expect(getRound?.outputs[0]?.components).toContainEqual({
      name: "totalFinalizedLiability",
      type: "uint256",
    });
    expect(
      getRound?.outputs[0]?.components.some(
        (component) => component.name === "totalAccuracyScore",
      ),
    ).toBe(false);
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
