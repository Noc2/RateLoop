import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

const ROUND_SNAPSHOT_DOMAIN = keccak256(
  toBytes("rateloop.correlation.round-payout.v1"),
);

export function roundPayoutSnapshotKey(params: {
  domain: number | bigint;
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        ROUND_SNAPSHOT_DOMAIN,
        Number(params.domain),
        params.rewardPoolId,
        params.contentId,
        params.roundId,
      ],
    ),
  );
}
