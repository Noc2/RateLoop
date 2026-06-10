import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DrandUnavailableError,
  FailoverChainClient,
  isDrandUnavailableError,
  resetTlockClientCacheForTests,
  resolveTlockClientForDrandChain,
} from "../drand.js";
import type { ChainClient } from "tlock-js";

const BEACON = { round: 42, randomness: "ab", signature: "cd" };

function makeRelayClient(baseUrl: string): ChainClient & {
  get: ReturnType<typeof vi.fn>;
  latest: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn().mockResolvedValue({ hash: "beef", period: 3 });
  const client = {
    options: {
      disableBeaconVerification: false,
      noCache: false,
      chainVerificationParams: { chainHash: "beef", publicKey: "f00d" },
    },
    get: vi.fn().mockResolvedValue(BEACON),
    latest: vi.fn().mockResolvedValue(BEACON),
    info,
    chain: () => ({ baseUrl, info }),
  };
  return client as unknown as ReturnType<typeof makeRelayClient>;
}

describe("FailoverChainClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("serves requests from the first relay while it is healthy", async () => {
    const primary = makeRelayClient("https://relay-a");
    const backup = makeRelayClient("https://relay-b");
    const client = new FailoverChainClient([primary, backup]);

    await expect(client.get(42)).resolves.toEqual(BEACON);
    expect(primary.get).toHaveBeenCalledWith(42);
    expect(backup.get).not.toHaveBeenCalled();
  });

  it("fails over to the next relay and remembers the healthy one", async () => {
    const primary = makeRelayClient("https://relay-a");
    primary.get.mockRejectedValue(new Error("fetch failed"));
    const backup = makeRelayClient("https://relay-b");
    const client = new FailoverChainClient([primary, backup]);

    await expect(client.get(42)).resolves.toEqual(BEACON);
    expect(backup.get).toHaveBeenCalledWith(42);

    // Subsequent requests start at the relay that last succeeded.
    await expect(client.get(43)).resolves.toEqual(BEACON);
    expect(primary.get).toHaveBeenCalledTimes(1);
    expect(backup.get).toHaveBeenCalledTimes(2);
  });

  it("throws DrandUnavailableError naming every relay when all fail", async () => {
    const primary = makeRelayClient("https://relay-a");
    primary.get.mockRejectedValue(new Error("timeout"));
    const backup = makeRelayClient("https://relay-b");
    backup.get.mockRejectedValue(new Error("503"));
    const client = new FailoverChainClient([primary, backup]);

    const failure = await client.get(42).then(
      () => null,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(DrandUnavailableError);
    expect(isDrandUnavailableError(failure)).toBe(true);
    expect((failure as Error).message).toContain("https://relay-a: timeout");
    expect((failure as Error).message).toContain("https://relay-b: 503");
  });

  it("fails over chain info requests too", async () => {
    const primary = makeRelayClient("https://relay-a");
    primary.info.mockRejectedValue(new Error("down"));
    const backup = makeRelayClient("https://relay-b");
    const client = new FailoverChainClient([primary, backup]);

    await expect(client.chain().info()).resolves.toEqual({
      hash: "beef",
      period: 3,
    });
    expect(backup.info).toHaveBeenCalled();
  });

  it("exposes the relay options so fetchBeacon keeps verifying signatures", () => {
    const primary = makeRelayClient("https://relay-a");
    const client = new FailoverChainClient([primary]);
    expect(client.options.chainVerificationParams).toEqual({
      chainHash: "beef",
      publicKey: "f00d",
    });
  });
});

describe("resolveTlockClientForDrandChain", () => {
  beforeEach(() => {
    resetTlockClientCacheForTests();
  });

  it("caches one failover client per chain", () => {
    const first = resolveTlockClientForDrandChain(undefined);
    const second = resolveTlockClientForDrandChain(undefined);
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(FailoverChainClient);
  });

  it("rejects unknown drand chains", () => {
    expect(() =>
      resolveTlockClientForDrandChain(`0x${"99".repeat(32)}`),
    ).toThrow("Unsupported drand chain");
  });

  it("rejects malformed chain hashes", () => {
    expect(() => resolveTlockClientForDrandChain("0x1234")).toThrow(
      "Invalid drand chain hash",
    );
  });
});
