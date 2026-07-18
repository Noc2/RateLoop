import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Address,
} from "viem";
import {
  TOKENLESS_REVEAL_TYPEHASH,
  decodeTokenlessRevealPayload,
  encodeTokenlessRevealPayload,
  tokenlessPayoutCommitment,
  tokenlessRevealCommitment,
} from "../sealed-payload.js";

const material = {
  roundId: 7n,
  voteKey: "0x0000000000000000000000000000000000000011" as Address,
  vote: 1 as const,
  predictedUpBps: 7000 as const,
  responseHash: `0x${"22".repeat(32)}` as const,
  payoutAddress: "0x0000000000000000000000000000000000000033" as Address,
  salt: `0x${"44".repeat(32)}` as const,
};

describe("tokenless sealed reveal payload", () => {
  it("round trips the complete claim and reveal material", () => {
    expect(
      decodeTokenlessRevealPayload(encodeTokenlessRevealPayload(material)),
    ).toEqual(material);
  });

  it("matches the exact on-chain payout and reveal commitments", () => {
    expect(TOKENLESS_REVEAL_TYPEHASH).toBe(
      "0x11d449d9f75919471b9d606008515b3b3181f95c7a321ecb911976a763a56ee5",
    );
    expect(
      tokenlessPayoutCommitment(material.payoutAddress, material.salt),
    ).toBe(
      keccak256(
        encodeAbiParameters(
          parseAbiParameters("address payoutAddress,bytes32 salt"),
          [material.payoutAddress, material.salt],
        ),
      ),
    );
    expect(tokenlessRevealCommitment(material)).toBe(
      keccak256(
        encodeAbiParameters(
          parseAbiParameters(
            "bytes32 typehash,uint256 roundId,address voteKey,uint8 vote,uint16 predictedUpBps,bytes32 responseHash,address payoutAddress,bytes32 salt",
          ),
          [
            TOKENLESS_REVEAL_TYPEHASH,
            material.roundId,
            material.voteKey,
            material.vote,
            material.predictedUpBps,
            material.responseHash,
            material.payoutAddress,
            material.salt,
          ],
        ),
      ),
    );
  });

  it("rejects another protocol magic", () => {
    const encoded = encodeTokenlessRevealPayload(material);
    const wrongMagic = `0x00000000${encoded.slice(10)}` as const;
    expect(() => decodeTokenlessRevealPayload(wrongMagic)).toThrow(
      /wrong protocol magic/,
    );
  });

  it("accepts the exact RBTS one-percent prediction grid", () => {
    const fineGrained = { ...material, predictedUpBps: 5_100 };
    expect(
      decodeTokenlessRevealPayload(encodeTokenlessRevealPayload(fineGrained)),
    ).toEqual(fineGrained);
    expect(() =>
      decodeTokenlessRevealPayload(
        encodeTokenlessRevealPayload({ ...material, predictedUpBps: 5_050 }),
      ),
    ).toThrow(/one-percent grid/);
  });
});
