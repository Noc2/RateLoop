import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted spy so the test body can stub timelockDecrypt. Only the keeper's
// direct `timelockDecrypt` import is mocked here; the @rateloop/contracts
// voting resolver dynamically imports the real tlock-js and builds a real drand
// client, so the routing tests below assert on that client's beacon URL.
const tlockMocks = vi.hoisted(() => ({
  timelockDecrypt: vi.fn(),
}));

vi.mock("tlock-js", async (importActual) => {
  const actual = await importActual<typeof import("tlock-js")>();
  return { ...actual, timelockDecrypt: tlockMocks.timelockDecrypt };
});

const MAINNET_QUICKNET_HASH =
  "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971" as const;
const QUICKNET_T_HASH =
  "0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5" as const;

// Extract the drand beacon base URL of the client a decrypt call was routed to.
function lastDecryptClientBaseUrl(): string {
  const [, client] = vi.mocked(timelockDecrypt).mock.calls.at(-1)!;
  return (client as { chain: () => { baseUrl: string } }).chain().baseUrl;
}

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

  it("decrypts a quicknet-t commit with the quicknet-t beacon, not mainnet", async () => {
    // Regression for the keeper hardcoding mainnetClient(): the World Chain
    // Sepolia (4801) deployment commits rounds to quicknet-t, so a quicknet-t
    // commit must be decrypted with the quicknet-t client, never the mainnet
    // beacon (which would yield a wrong key and brick every testnet reveal).
    const plaintext = Buffer.alloc(36);
    plaintext.writeUInt8(2, 0);
    plaintext.writeUInt8(1, 1);
    plaintext.writeUInt16BE(5000, 2);
    Buffer.alloc(32, 0xab).copy(plaintext, 4);
    vi.mocked(timelockDecrypt).mockResolvedValue(plaintext);

    const hex = `0x${Buffer.from("ARMORED", "utf-8").toString("hex")}`;
    const result = await decryptTlockVoteCiphertext(
      hex as `0x${string}`,
      QUICKNET_T_HASH,
    );

    expect(result).not.toBeNull();
    expect(result!.predictedUpBps).toBe(5000);
    // The ciphertext was handed to the quicknet-t beacon, not mainnet quicknet.
    const baseUrl = lastDecryptClientBaseUrl();
    expect(baseUrl).toContain(QUICKNET_T_HASH.slice(2));
    expect(baseUrl).not.toContain(MAINNET_QUICKNET_HASH.slice(2));
  });

  it("hard-fails (does not silently fall back) on an unsupported drand chain hash", async () => {
    const hex = `0x${Buffer.from("ARMORED", "utf-8").toString("hex")}`;
    const unsupportedHash = `0x${"11".repeat(32)}` as `0x${string}`;
    await expect(
      decryptTlockVoteCiphertext(hex as `0x${string}`, unsupportedHash),
    ).rejects.toThrow(/Unsupported drand chain/i);
    expect(tlockMocks.timelockDecrypt).not.toHaveBeenCalled();
  });

  it("decrypts a mainnet-quicknet commit with the mainnet beacon", async () => {
    const plaintext = Buffer.alloc(36);
    plaintext.writeUInt8(2, 0);
    plaintext.writeUInt8(0, 1);
    plaintext.writeUInt16BE(2500, 2);
    Buffer.alloc(32, 0xcd).copy(plaintext, 4);
    vi.mocked(timelockDecrypt).mockResolvedValue(plaintext);

    const hex = `0x${Buffer.from("ARMORED", "utf-8").toString("hex")}`;
    const result = await decryptTlockVoteCiphertext(
      hex as `0x${string}`,
      MAINNET_QUICKNET_HASH,
    );

    expect(result).not.toBeNull();
    expect(result!.isUp).toBe(false);
    const baseUrl = lastDecryptClientBaseUrl();
    expect(baseUrl).toContain(MAINNET_QUICKNET_HASH.slice(2));
    expect(baseUrl).not.toContain(QUICKNET_T_HASH.slice(2));
  });
});
