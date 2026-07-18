import { describe, expect, it } from "vitest";
import {
  ContractFunctionRevertedError,
  encodeErrorResult,
  parseAbi,
} from "viem";
import { isExpectedPanelRaceError } from "../expected-panel-race.js";
import { TokenlessPanelAbi } from "../tokenless-abi.js";

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
