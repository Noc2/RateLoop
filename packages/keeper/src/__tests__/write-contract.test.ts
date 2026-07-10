import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertReason, isExpectedRevert } from "../revert-utils.js";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    maxGasPerTx: 2_000_000,
  },
}));

vi.mock("../config.js", () => ({
  config: mockConfig,
}));

import { writeContractAndConfirm } from "../keeper.js";

const ENGINE = "0x1111111111111111111111111111111111111111" as const;
const ACCOUNT = { address: "0x4444444444444444444444444444444444444444" };

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    chain: {},
    account: ACCOUNT,
    address: ENGINE,
    abi: [],
    functionName: "settleRound",
    args: [1n, 1n],
    ...overrides,
  } as never;
}

function makeClients(options: {
  estimate?: bigint;
  estimateError?: Error;
  omitEstimate?: boolean;
  simulateError?: Error;
}) {
  const estimateContractGas = vi.fn(async () => {
    if (options.estimateError) throw options.estimateError;
    return options.estimate ?? 100_000n;
  });
  const simulateContract = vi.fn(async () => {
    if (options.simulateError) throw options.simulateError;
    return { request: makeRequest() };
  });
  const publicClient = {
    ...(options.omitEstimate ? {} : { estimateContractGas }),
    simulateContract,
    waitForTransactionReceipt: vi
      .fn()
      .mockResolvedValue({ status: "success" }),
  };
  const walletClient = {
    writeContract: vi.fn().mockResolvedValue("0xhash"),
  };
  return { publicClient, walletClient, estimateContractGas, simulateContract };
}

describe("writeContractAndConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.maxGasPerTx = 2_000_000;
  });

  it("estimates gas before broadcasting and applies a buffered estimate", async () => {
    const { publicClient, walletClient, estimateContractGas } = makeClients({
      estimate: 100_000n,
    });

    const hash = await writeContractAndConfirm(
      publicClient as never,
      walletClient as never,
      makeRequest(),
    );

    expect(hash).toBe("0xhash");
    expect(estimateContractGas).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ENGINE,
        functionName: "settleRound",
        args: [1n, 1n],
        account: ACCOUNT,
      }),
    );
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 120_000n }),
    );
  });

  it("caps the buffered estimate at maxGasPerTx", async () => {
    const { publicClient, walletClient } = makeClients({
      estimate: 1_900_000n, // buffered: 2,280,000 > 2,000,000 cap
    });

    await writeContractAndConfirm(
      publicClient as never,
      walletClient as never,
      makeRequest(),
    );

    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 2_000_000n }),
    );
  });

  it("does not broadcast when estimation reverts with an expected reason", async () => {
    const { publicClient, walletClient } = makeClients({
      estimateError: new Error("UnrevealedPastEpochVotes"),
    });

    let thrown: unknown;
    try {
      await writeContractAndConfirm(
        publicClient as never,
        walletClient as never,
        makeRequest(),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
    expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
    // Callers classify estimation reverts exactly like broadcast reverts.
    expect(isExpectedRevert(getRevertReason(thrown))).toBe(true);
  });

  it("does not broadcast when estimation reverts unexpectedly", async () => {
    const { publicClient, walletClient } = makeClients({
      estimateError: new Error("SomethingWentVeryWrong"),
    });

    let thrown: unknown;
    try {
      await writeContractAndConfirm(
        publicClient as never,
        walletClient as never,
        makeRequest(),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
    expect(isExpectedRevert(getRevertReason(thrown))).toBe(false);
  });

  it("refuses to broadcast when the raw estimate exceeds maxGasPerTx", async () => {
    const { publicClient, walletClient } = makeClients({
      estimate: 3_000_000n,
    });

    await expect(
      writeContractAndConfirm(
        publicClient as never,
        walletClient as never,
        makeRequest(),
      ),
    ).rejects.toThrow(/exceeds MAX_GAS_PER_TX 2000000/);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("uses the unbuffered cap-free estimate when maxGasPerTx is unset", async () => {
    mockConfig.maxGasPerTx = 0;
    const { publicClient, walletClient } = makeClients({
      estimate: 3_000_000n,
    });

    await writeContractAndConfirm(
      publicClient as never,
      walletClient as never,
      makeRequest(),
    );

    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 3_600_000n }),
    );
  });

  it("respects caller-provided gas and skips estimation", async () => {
    const { publicClient, walletClient, estimateContractGas } = makeClients({});

    await writeContractAndConfirm(
      publicClient as never,
      walletClient as never,
      makeRequest({ gas: 55_000n }),
    );

    expect(estimateContractGas).not.toHaveBeenCalled();
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 55_000n }),
    );
  });

  it("falls back to the legacy gas cap when the client cannot estimate", async () => {
    const { publicClient, walletClient } = makeClients({ omitEstimate: true });

    await writeContractAndConfirm(
      publicClient as never,
      walletClient as never,
      makeRequest(),
    );

    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 2_000_000n }),
    );
  });

  it("throws when the mined transaction reverted on-chain", async () => {
    const { publicClient, walletClient, simulateContract } = makeClients({
      estimate: 100_000n,
    });
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: "reverted",
    });

    await expect(
      writeContractAndConfirm(
        publicClient as never,
        walletClient as never,
        makeRequest(),
      ),
    ).rejects.toThrow(/reverted on-chain/);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(simulateContract).toHaveBeenCalledWith(
      expect.not.objectContaining({
        gas: expect.anything(),
      }),
    );
  });

  it("recovers a simulation reason after a mined transaction reverted on-chain", async () => {
    const { publicClient, walletClient, simulateContract } = makeClients({
      estimate: 100_000n,
      simulateError: new Error("Too few eligible voters"),
    });
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: "reverted",
    });

    await expect(
      writeContractAndConfirm(
        publicClient as never,
        walletClient as never,
        makeRequest(),
      ),
    ).rejects.toThrow(/Too few eligible voters/);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(simulateContract).toHaveBeenCalledTimes(1);
  });

  it("retries transient RPC failures during gas estimation", async () => {
    const transientError = new Error("HTTP request failed");
    const { publicClient, walletClient, estimateContractGas } = makeClients({
      estimate: 100_000n,
    });
    estimateContractGas
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(100_000n);

    const hash = await writeContractAndConfirm(
      publicClient as never,
      walletClient as never,
      makeRequest(),
    );

    expect(hash).toBe("0xhash");
    expect(estimateContractGas).toHaveBeenCalledTimes(3);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });

  it("does not retry deterministic estimation reverts", async () => {
    const { publicClient, walletClient, estimateContractGas } = makeClients({
      estimateError: new Error("AlreadyRevealed"),
    });

    await expect(
      writeContractAndConfirm(
        publicClient as never,
        walletClient as never,
        makeRequest(),
      ),
    ).rejects.toThrow("AlreadyRevealed");

    expect(estimateContractGas).toHaveBeenCalledTimes(1);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("does not retry an ambiguous transaction broadcast failure", async () => {
    const transientError = new Error("request timeout");
    const { publicClient, walletClient } = makeClients({ estimate: 100_000n });
    walletClient.writeContract
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce("0xsecondhash");

    await expect(
      writeContractAndConfirm(
        publicClient as never,
        walletClient as never,
        makeRequest(),
      ),
    ).rejects.toThrow("request timeout");

    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("retries transient RPC failures while waiting for the receipt", async () => {
    const transientError = new Error("request timeout");
    const { publicClient, walletClient } = makeClients({ estimate: 100_000n });
    publicClient.waitForTransactionReceipt
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ status: "success" });

    const hash = await writeContractAndConfirm(
      publicClient as never,
      walletClient as never,
      makeRequest(),
    );

    expect(hash).toBe("0xhash");
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledTimes(3);
  });
});
