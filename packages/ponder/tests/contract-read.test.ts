import { describe, expect, it, vi } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  TimeoutError,
} from "viem";

import {
  isDeterministicContractCallError,
  tryContractRead,
} from "../src/contract-read.js";

function revertError() {
  return new ContractFunctionRevertedError({
    abi: [],
    functionName: "commitIdentityState",
    message: "execution reverted",
  });
}

function transportError() {
  return new HttpRequestError({
    url: "http://localhost:8545",
    details: "fetch failed",
  });
}

describe("isDeterministicContractCallError", () => {
  it("matches contract reverts and zero-data responses", () => {
    expect(isDeterministicContractCallError(revertError())).toBe(true);
    expect(
      isDeterministicContractCallError(
        new ContractFunctionZeroDataError({ functionName: "rbtsCommitState" }),
      ),
    ).toBe(true);
  });

  it("matches reverts wrapped in another viem error", () => {
    const wrapped = new BaseError("call failed", { cause: revertError() });
    expect(isDeterministicContractCallError(wrapped)).toBe(true);
  });

  it("does not match transport, timeout, or unknown errors", () => {
    expect(isDeterministicContractCallError(transportError())).toBe(false);
    expect(
      isDeterministicContractCallError(
        new TimeoutError({ body: {}, url: "http://localhost:8545" }),
      ),
    ).toBe(false);
    expect(isDeterministicContractCallError(new Error("boom"))).toBe(false);
    expect(
      isDeterministicContractCallError(
        new BaseError("call failed", { cause: transportError() }),
      ),
    ).toBe(false);
  });
});

describe("tryContractRead", () => {
  it("returns the value on success", async () => {
    const read = vi.fn(async () => 42n);
    await expect(tryContractRead(read)).resolves.toEqual({
      ok: true,
      value: 42n,
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reports deterministic call failures without retrying", async () => {
    const error = revertError();
    const read = vi.fn(async () => {
      throw error;
    });
    await expect(tryContractRead(read, { backoffMs: 0 })).resolves.toEqual({
      ok: false,
      error,
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures and eventually succeeds", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(transportError())
      .mockResolvedValueOnce(7n);
    await expect(tryContractRead(read, { backoffMs: 0 })).resolves.toEqual({
      ok: true,
      value: 7n,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on transient failures", async () => {
    const error = transportError();
    const read = vi.fn(async () => {
      throw error;
    });
    await expect(
      tryContractRead(read, { attempts: 3, backoffMs: 0 }),
    ).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("treats unknown errors as transient and rethrows them", async () => {
    const error = new Error("socket hang up");
    const read = vi.fn(async () => {
      throw error;
    });
    await expect(
      tryContractRead(read, { attempts: 2, backoffMs: 0 }),
    ).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
