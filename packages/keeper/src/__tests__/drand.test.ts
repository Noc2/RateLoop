import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DrandUnavailableError,
  FailoverChainClient,
  MAINNET_QUICKNET_CHAIN_HASH,
  QUICKNET_T_CHAIN_HASH,
  TLOCK_JS_TESTNET_CHAIN_HASH,
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
    vi.stubEnv("CHAIN_ID", "31337");
    vi.stubEnv("KEEPER_ENABLE_LEGACY_TLOCK_JS_TESTNET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caches one failover client per chain", () => {
    const first = resolveTlockClientForDrandChain(undefined);
    const second = resolveTlockClientForDrandChain(undefined);
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(FailoverChainClient);
    expect(first.options.chainVerificationParams?.chainHash).toBe(
      MAINNET_QUICKNET_CHAIN_HASH,
    );
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

  it("gates the deprecated tlock-js testnet chain behind an explicit env opt-in", () => {
    expect(() =>
      resolveTlockClientForDrandChain(`0x${TLOCK_JS_TESTNET_CHAIN_HASH}`),
    ).toThrow("Unsupported deprecated drand chain");

    vi.stubEnv("KEEPER_ENABLE_LEGACY_TLOCK_JS_TESTNET", "true");
    resetTlockClientCacheForTests();

    expect(
      resolveTlockClientForDrandChain(`0x${TLOCK_JS_TESTNET_CHAIN_HASH}`),
    ).toBeInstanceOf(FailoverChainClient);
  });

  it("rejects non-quicknet hashes for World Chain mainnet", () => {
    vi.stubEnv("CHAIN_ID", "480");

    expect(() =>
      resolveTlockClientForDrandChain(`0x${QUICKNET_T_CHAIN_HASH}`),
    ).toThrow("World Chain mainnet keeper requires drand quicknet chain hash");
  });
});
