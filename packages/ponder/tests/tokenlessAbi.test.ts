import { describe, expect, it } from "vitest";
import { tokenlessRound } from "../ponder.schema";
import { tokenlessPanelAbi } from "../src/tokenlessAbi";

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

  it("decodes the exact v2 admission policy hash from RoundCreated and getRound", () => {
    const roundCreated = tokenlessPanelAbi.find(
      (entry) => entry.type === "event" && entry.name === "RoundCreated",
    );
    const getRound = tokenlessPanelAbi.find(
      (entry) => entry.type === "function" && entry.name === "getRound",
    );

    expect(roundCreated?.inputs.map(({ name, type, indexed }) => ({ name, type, indexed }))).toEqual([
      { name: "roundId", type: "uint256", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "contentId", type: "bytes32", indexed: true },
      { name: "termsHash", type: "bytes32", indexed: false },
      { name: "admissionPolicyHash", type: "bytes32", indexed: false },
      { name: "bountyAmount", type: "uint256", indexed: false },
      { name: "feeAmount", type: "uint256", indexed: false },
      { name: "attemptReserve", type: "uint256", indexed: false },
    ]);
    expect(getRound?.outputs[0]?.components).toContainEqual({
      name: "admissionPolicyHash",
      type: "bytes32",
    });
    expect(getRound?.outputs[0]?.components).toContainEqual({
      name: "claimDeadline",
      type: "uint256",
    });
    expect(getRound?.outputs[0]?.components.some((component) => component.name === "requiredTier")).toBe(false);
  });

  it("stores the policy hash without retaining the v1 tier column", () => {
    expect(tokenlessRound.admissionPolicyHash.columnType).toBe("PgHex");
    expect(tokenlessRound.finalizedAt.columnType).toBe("PgEvmBigint");
    expect(tokenlessRound.finalizedBlock.columnType).toBe("PgEvmBigint");
    expect(tokenlessRound.finalizedBlockHash.columnType).toBe("PgHex");
    expect(tokenlessRound.finalizedTxHash.columnType).toBe("PgHex");
    expect("requiredTier" in tokenlessRound).toBe(false);
  });
});
