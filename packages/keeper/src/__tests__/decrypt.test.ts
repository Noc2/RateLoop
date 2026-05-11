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

import { decryptTlockVoteCiphertext } from "../keeper.js";
import { timelockDecrypt } from "tlock-js";

describe("decryptTlockVoteCiphertext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
