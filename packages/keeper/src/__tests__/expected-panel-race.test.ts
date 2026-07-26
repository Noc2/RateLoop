import { describe, expect, it } from "vitest";
import {
  ContractFunctionRevertedError,
  encodeErrorResult,
  parseAbi,
} from "viem";
import {
  isExpectedFeedbackBonusRaceError,
  isExpectedPanelRaceError,
} from "../expected-panel-race.js";
import {
  TokenlessFeedbackBonusAbi,
  TokenlessPanelAbi,
} from "../tokenless-abi.js";

function revert(errorName: "CursorMismatch" | "InvalidState") {
  const data = encodeErrorResult({
    abi: TokenlessPanelAbi,
    errorName,
  });
  return {
    data,
    error: new ContractFunctionRevertedError({
      abi: TokenlessPanelAbi,
      data,
      functionName: "permissionlessCall",
    }),
  };
}

describe("expected TokenlessPanel race errors", () => {
  it("decodes the real InvalidState selector from the keeper ABI", () => {
    const { data, error } = revert("InvalidState");

    expect(data).toBe("0xbaf3f0f7");
    expect(error.data?.errorName).toBe("InvalidState");
    expect(
      isExpectedPanelRaceError(
        new Error("competing caller won", { cause: error }),
      ),
    ).toBe(true);
  });

  it("classifies nested raw CursorMismatch data from another caller", () => {
    const { data } = revert("CursorMismatch");

    expect(
      isExpectedPanelRaceError({
        cause: { data: { data } },
      }),
    ).toBe(true);
  });

  it("does not trust provider display text or suppress non-race reverts", () => {
    const data = encodeErrorResult({
      abi: parseAbi(["error InvalidCommitment()"]),
      errorName: "InvalidCommitment",
    });
    const error = new ContractFunctionRevertedError({
      abi: TokenlessPanelAbi,
      data,
      functionName: "reveal",
    });

    expect(isExpectedPanelRaceError(error)).toBe(false);
    expect(isExpectedPanelRaceError(new Error("InvalidState"))).toBe(false);
  });
});

describe("expected TokenlessFeedbackBonus race errors", () => {
  it.each(["AwardWindowClosed", "InvalidPool", "NothingToRefund"] as const)(
    "classifies decoded and raw %s reverts",
    (errorName) => {
      const data = encodeErrorResult({
        abi: TokenlessFeedbackBonusAbi,
        errorName,
      });
      const decoded = new ContractFunctionRevertedError({
        abi: TokenlessFeedbackBonusAbi,
        data,
        functionName: "refundRemainder",
      });

      expect(
        isExpectedFeedbackBonusRaceError(
          new Error("competing caller won", { cause: decoded }),
        ),
      ).toBe(true);
      expect(
        isExpectedFeedbackBonusRaceError({ cause: { data: { data } } }),
      ).toBe(true);
    },
  );

  it("does not trust provider text or suppress an unrelated feedback revert", () => {
    const data = encodeErrorResult({
      abi: parseAbi(["error Unauthorized()"]),
      errorName: "Unauthorized",
    });

    expect(isExpectedFeedbackBonusRaceError({ data })).toBe(false);
    expect(
      isExpectedFeedbackBonusRaceError(new Error("NothingToRefund")),
    ).toBe(false);
  });
});
