import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  timelockDecryptMock,
  mainnetClientMock,
  testnetClientMock,
  httpCachingChainMock,
  httpChainClientMock,
} = vi.hoisted(() => ({
  timelockDecryptMock: vi.fn(),
  mainnetClientMock: vi.fn(() => ({ kind: "mainnet" })),
  testnetClientMock: vi.fn(() => ({ kind: "testnet" })),
  httpCachingChainMock: vi.fn(function (
    this: { url?: string; options?: unknown },
    url: string,
    options: unknown,
  ) {
    this.url = url;
    this.options = options;
  }),
  httpChainClientMock: vi.fn(function (
    this: { kind?: string; chain?: unknown; options?: unknown; httpOptions?: unknown },
    chain: unknown,
    options: unknown,
    httpOptions: unknown,
  ) {
    this.kind = "quicknet-t";
    this.chain = chain;
    this.options = options;
    this.httpOptions = httpOptions;
  }),
}));

// Mock tlock-js before importing keeper
vi.mock("tlock-js", () => ({
  timelockDecrypt: timelockDecryptMock,
  mainnetClient: mainnetClientMock,
  testnetClient: testnetClientMock,
  HttpCachingChain: httpCachingChainMock,
  HttpChainClient: httpChainClientMock,
}));

// Mock config to avoid dotenv side effects
vi.mock("../config.js", () => ({
  config: {
    contracts: { votingEngine: "0x0", contentRegistry: "0x0" },
    dormancyPeriod: 2592000n,
  },
}));

// Mock logger
vi.mock("../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { decryptTlockVoteCiphertext, resetKeeperStateForTests } from "../keeper.js";
import { FailoverChainClient } from "../drand.js";
import { timelockDecrypt } from "tlock-js";

const MAINNET_QUICKNET_DRAND_CHAIN_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const QUICKNET_T_DRAND_CHAIN_HASH =
  "0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5" as const;
const QUICKNET_T_DRAND_URL =
  "https://testnet-api.drand.cloudflare.com/cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5";

describe("decryptTlockVoteCiphertext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeeperStateForTests();
  });

  it("returns the RBTS signal, crowd prediction, and salt for valid plaintext", async () => {
    const saltHex = "ab".repeat(32);
    const saltBytes = Buffer.from(saltHex, "hex");
    const plaintext = Buffer.alloc(36);
    plaintext.writeUInt8(2, 0);
    plaintext.writeUInt8(1, 1);
    plaintext.writeUInt16BE(6900, 2);
    saltBytes.copy(plaintext, 4);

    vi.mocked(timelockDecrypt).mockResolvedValue(plaintext);

    // Build a hex ciphertext (armored AGE string as hex bytes)
    const armored = "FAKE-ARMORED-AGE-STRING";
    const hex = `0x${Buffer.from(armored, "utf-8").toString("hex")}`;

    const result = await decryptTlockVoteCiphertext(hex as `0x${string}`);
    expect(result).not.toBeNull();
    expect(result!.isUp).toBe(true);
    expect(result!.predictedUpBps).toBe(6900);
    expect(result!.predictedUpPercent).toBe(69);
    expect(result!.salt).toBe(`0x${saltHex}`);
    expect(vi.mocked(timelockDecrypt).mock.calls[0]?.[1]).toBeInstanceOf(
      FailoverChainClient,
    );
    // Without explicit chain metadata, the keeper defaults to drand quicknet and
    // configures every independent mainnet relay for failover.
    const constructedUrls = httpCachingChainMock.mock.calls.map(
      (call) => call[0],
    );
    expect(constructedUrls).toEqual([
      `https://api.drand.sh/${MAINNET_QUICKNET_DRAND_CHAIN_HASH}`,
      `https://api2.drand.sh/${MAINNET_QUICKNET_DRAND_CHAIN_HASH}`,
      `https://api3.drand.sh/${MAINNET_QUICKNET_DRAND_CHAIN_HASH}`,
      `https://drand.cloudflare.com/${MAINNET_QUICKNET_DRAND_CHAIN_HASH}`,
    ]);
  });

  it("uses the drand quicknet-t client for World Chain Sepolia ciphertexts", async () => {
    const saltHex = "ef".repeat(32);
    const plaintext = Buffer.alloc(36);
    plaintext.writeUInt8(2, 0);
    plaintext.writeUInt8(1, 1);
    plaintext.writeUInt16BE(5500, 2);
    Buffer.from(saltHex, "hex").copy(plaintext, 4);

    vi.mocked(timelockDecrypt).mockResolvedValue(plaintext);

    const armored = "FAKE-SEPOLIA-ARMORED-AGE-STRING";
    const hex = `0x${Buffer.from(armored, "utf-8").toString("hex")}`;

    const result = await decryptTlockVoteCiphertext(
      hex as `0x${string}`,
      QUICKNET_T_DRAND_CHAIN_HASH,
    );

    expect(result?.predictedUpBps).toBe(5500);
    expect(httpCachingChainMock).toHaveBeenCalledWith(
      QUICKNET_T_DRAND_URL,
      expect.objectContaining({
        chainVerificationParams: expect.objectContaining({
          chainHash: QUICKNET_T_DRAND_CHAIN_HASH.slice(2),
        }),
      }),
    );
    // The quicknet-t failover list includes the pl-us testnet relay as backup.
    expect(httpCachingChainMock).toHaveBeenCalledWith(
      `https://pl-us.testnet.drand.sh/${QUICKNET_T_DRAND_CHAIN_HASH.slice(2)}`,
      expect.any(Object),
    );
    expect(httpChainClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: QUICKNET_T_DRAND_URL }),
      expect.any(Object),
      { userAgent: "rateloop-keeper" },
    );
    expect(vi.mocked(timelockDecrypt).mock.calls[0]?.[1]).toBeInstanceOf(
      FailoverChainClient,
    );
  });

  it("returns null for out-of-range prediction", async () => {
    const salt = Buffer.alloc(32, 0xcd);
    const plaintext = Buffer.alloc(36);
    plaintext.writeUInt8(2, 0);
    plaintext.writeUInt8(1, 1);
    plaintext.writeUInt16BE(10001, 2);
    salt.copy(plaintext, 4);

    vi.mocked(timelockDecrypt).mockResolvedValue(plaintext);

    const hex = `0x${Buffer.from("ARMORED", "utf-8").toString("hex")}`;
    const result = await decryptTlockVoteCiphertext(hex as `0x${string}`);
    expect(result).toBeNull();
  });

  it("returns null for wrong-length plaintext", async () => {
    vi.mocked(timelockDecrypt).mockResolvedValue(Buffer.alloc(10));

    const hex = `0x${Buffer.from("ARMORED", "utf-8").toString("hex")}`;
    const result = await decryptTlockVoteCiphertext(hex as `0x${string}`);
    expect(result).toBeNull();
  });

  it("propagates beacon errors", async () => {
    vi.mocked(timelockDecrypt).mockRejectedValue(
      new Error("beacon not available"),
    );

    const hex = `0x${Buffer.from("ARMORED", "utf-8").toString("hex")}`;
    await expect(
      decryptTlockVoteCiphertext(hex as `0x${string}`),
    ).rejects.toThrow("beacon not available");
  });
});
