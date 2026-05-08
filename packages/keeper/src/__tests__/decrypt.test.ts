import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock tlock-js before importing keeper
vi.mock("tlock-js", () => ({
  timelockDecrypt: vi.fn(),
  mainnetClient: () => ({}),
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

import { decryptTlockPredictionCiphertext } from "../keeper.js";
import { timelockDecrypt } from "tlock-js";

describe("decryptTlockPredictionCiphertext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns opinion, crowd prediction, rating, and salt for valid plaintext", async () => {
    const saltHex = "ab".repeat(32);
    const saltBytes = Buffer.from(saltHex, "hex");
    const plaintext = Buffer.alloc(37);
    plaintext.writeUInt8(1, 0);
    plaintext.writeUInt16BE(7250, 1);
    plaintext.writeUInt16BE(6900, 3);
    saltBytes.copy(plaintext, 5);

    vi.mocked(timelockDecrypt).mockResolvedValue(plaintext);

    // Build a hex ciphertext (armored AGE string as hex bytes)
    const armored = "FAKE-ARMORED-AGE-STRING";
    const hex = `0x${Buffer.from(armored, "utf-8").toString("hex")}`;

    const result = await decryptTlockPredictionCiphertext(hex as `0x${string}`);
    expect(result).not.toBeNull();
    expect(result!.opinionRatingBps).toBe(7250);
    expect(result!.predictedCrowdRatingBps).toBe(6900);
    expect(result!.predictedRatingBps).toBe(6900);
    expect(result!.rating).toBe(7.25);
    expect(result!.crowdRating).toBe(6.9);
    expect(result!.salt).toBe(`0x${saltHex}`);
  });

  it("returns null for out-of-range prediction", async () => {
    const salt = Buffer.alloc(32, 0xcd);
    const plaintext = Buffer.alloc(37);
    plaintext.writeUInt8(1, 0);
    plaintext.writeUInt16BE(10001, 1);
    plaintext.writeUInt16BE(6900, 3);
    salt.copy(plaintext, 5);

    vi.mocked(timelockDecrypt).mockResolvedValue(plaintext);

    const hex = `0x${Buffer.from("ARMORED", "utf-8").toString("hex")}`;
    const result = await decryptTlockPredictionCiphertext(hex as `0x${string}`);
    expect(result).toBeNull();
  });

  it("returns null for wrong-length plaintext", async () => {
    vi.mocked(timelockDecrypt).mockResolvedValue(Buffer.alloc(10));

    const hex = `0x${Buffer.from("ARMORED", "utf-8").toString("hex")}`;
    const result = await decryptTlockPredictionCiphertext(hex as `0x${string}`);
    expect(result).toBeNull();
  });

  it("propagates beacon errors", async () => {
    vi.mocked(timelockDecrypt).mockRejectedValue(new Error("beacon not available"));

    const hex = `0x${Buffer.from("ARMORED", "utf-8").toString("hex")}`;
    await expect(decryptTlockPredictionCiphertext(hex as `0x${string}`)).rejects.toThrow("beacon not available");
  });
});
