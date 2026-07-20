import { describe, expect, it } from "vitest";
import { validateDrandBeaconEvidence } from "../drand.js";

const ROUND_1_SIGNATURE =
  "81d347e1c4be0e4277112de281d3a52aa1190bbd2f0ad7954e22799d168e61b60b4a0c46fc5a2777963cb739a0243e21";
const ROUND_1_RANDOMNESS =
  "5c1dd096cd32cd272fcd2ad6e4d46d33713d16618ede11bae63da90edc3fbb1b";
const ROUND_12345678_SIGNATURE =
  "b40845f2ae971025215f599b8af346bf329129d1d5ee416665472f91050acb3ecd31ee878033ba14842d4367010e1964";
const ROUND_12345678_RANDOMNESS =
  "c8788d522aa63a9fd2e715499097597dc94f33ee2bd0f78c5367e11ce825227b";

describe("quicknet-t beacon evidence", () => {
  it("preserves the live raw 48-byte proof and sha256 randomness", () => {
    for (const [round, randomness, signature] of [
      [1, ROUND_1_RANDOMNESS, ROUND_1_SIGNATURE],
      [12_345_678, ROUND_12345678_RANDOMNESS, ROUND_12345678_SIGNATURE],
    ] as const) {
      expect(
        validateDrandBeaconEvidence({ round, randomness, signature }, round)
      ).toEqual({
        randomness: `0x${randomness}`,
        proof: `0x${signature}`,
      });
    }
  });

  it("rejects non-48-byte signatures", () => {
    for (const signature of [
      ROUND_1_SIGNATURE.slice(0, -2),
      `${ROUND_1_SIGNATURE}00`,
      "zz".repeat(48),
    ]) {
      expect(() =>
        validateDrandBeaconEvidence(
          { round: 1, randomness: ROUND_1_RANDOMNESS, signature },
          1
        )
      ).toThrow(/malformed beacon evidence/);
    }
  });

  it("rejects wrong rounds and randomness that is not sha256(proof)", () => {
    expect(() =>
      validateDrandBeaconEvidence(
        {
          round: 2,
          randomness: ROUND_1_RANDOMNESS,
          signature: ROUND_1_SIGNATURE,
        },
        1
      )
    ).toThrow(/malformed beacon evidence/);

    expect(() =>
      validateDrandBeaconEvidence(
        {
          round: 1,
          randomness: "00".repeat(32),
          signature: ROUND_1_SIGNATURE,
        },
        1
      )
    ).toThrow(/inconsistent beacon randomness/);
  });
});
