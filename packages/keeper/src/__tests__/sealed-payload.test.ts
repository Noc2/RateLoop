import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  decodeTokenlessRevealPayload,
  encodeTokenlessRevealPayload,
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
      decodeTokenlessRevealPayload(encodeTokenlessRevealPayload(material))
    ).toEqual(material);
  });

  it("rejects another protocol magic", () => {
    const encoded = encodeTokenlessRevealPayload(material);
    const wrongMagic = `0x00000000${encoded.slice(10)}` as const;
    expect(() => decodeTokenlessRevealPayload(wrongMagic)).toThrow(
      /wrong protocol magic/
    );
  });
});
