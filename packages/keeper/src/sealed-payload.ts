import {
  decodeAbiParameters,
  encodeAbiParameters,
  hexToBytes,
  isAddress,
  keccak256,
  size,
  toHex,
  type Address,
  type Hex,
} from "viem";
import type { TokenlessRevealMaterial } from "./tokenless-types.js";

export const TOKENLESS_REVEAL_PAYLOAD_MAGIC = "0x524c5431" as const; // RLT1
export const TOKENLESS_REVEAL_PAYLOAD_VERSION = 1;

const PARAMETERS = [
  { name: "magic", type: "bytes4" },
  { name: "version", type: "uint8" },
  { name: "roundId", type: "uint256" },
  { name: "voteKey", type: "address" },
  { name: "vote", type: "uint8" },
  { name: "predictedUpBps", type: "uint16" },
  { name: "responseHash", type: "bytes32" },
  { name: "payoutAddress", type: "address" },
  { name: "salt", type: "bytes32" },
] as const;

const PAYOUT_COMMITMENT_PARAMETERS = [
  { name: "payoutAddress", type: "address" },
  { name: "salt", type: "bytes32" },
] as const;

const REVEAL_COMMITMENT_PARAMETERS = [
  { name: "typehash", type: "bytes32" },
  { name: "roundId", type: "uint256" },
  { name: "voteKey", type: "address" },
  { name: "vote", type: "uint8" },
  { name: "predictedUpBps", type: "uint16" },
  { name: "responseHash", type: "bytes32" },
  { name: "payoutAddress", type: "address" },
  { name: "salt", type: "bytes32" },
] as const;

export const TOKENLESS_REVEAL_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "Reveal(uint256 roundId,address voteKey,uint8 vote,uint16 predictedUpBps,bytes32 responseHash,address payoutAddress,bytes32 salt)",
  ),
);

function isPredictionGridValue(value: number) {
  return value >= 100 && value <= 9_900 && value % 100 === 0;
}

export function encodeTokenlessRevealPayload(
  material: TokenlessRevealMaterial,
): Hex {
  return encodeAbiParameters(PARAMETERS, [
    TOKENLESS_REVEAL_PAYLOAD_MAGIC,
    TOKENLESS_REVEAL_PAYLOAD_VERSION,
    material.roundId,
    material.voteKey,
    material.vote,
    material.predictedUpBps,
    material.responseHash,
    material.payoutAddress,
    material.salt,
  ]);
}

export function tokenlessPayoutCommitment(
  payoutAddress: Address,
  salt: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(PAYOUT_COMMITMENT_PARAMETERS, [payoutAddress, salt]),
  );
}

export function tokenlessRevealCommitment(
  material: TokenlessRevealMaterial,
): Hex {
  return keccak256(
    encodeAbiParameters(REVEAL_COMMITMENT_PARAMETERS, [
      TOKENLESS_REVEAL_TYPEHASH,
      material.roundId,
      material.voteKey,
      material.vote,
      material.predictedUpBps,
      material.responseHash,
      material.payoutAddress,
      material.salt,
    ]),
  );
}

export function decodeTokenlessRevealPayload(
  plaintext: Uint8Array | Hex,
): TokenlessRevealMaterial {
  const encoded =
    typeof plaintext === "string" ? plaintext : (toHex(plaintext) as Hex);
  const [
    magic,
    version,
    roundId,
    voteKey,
    vote,
    predictedUpBps,
    responseHash,
    payoutAddress,
    salt,
  ] = decodeAbiParameters(PARAMETERS, encoded);

  if (magic !== TOKENLESS_REVEAL_PAYLOAD_MAGIC) {
    throw new Error("Tokenless reveal payload has the wrong protocol magic.");
  }
  if (version !== TOKENLESS_REVEAL_PAYLOAD_VERSION) {
    throw new Error(`Unsupported tokenless reveal payload version ${version}.`);
  }
  if (vote !== 0 && vote !== 1) {
    throw new Error("Tokenless reveal payload vote must be 0 or 1.");
  }
  if (!isPredictionGridValue(predictedUpBps)) {
    throw new Error(
      "Tokenless reveal payload prediction must use the 100..9900 one-percent grid.",
    );
  }
  if (!isAddress(voteKey) || !isAddress(payoutAddress)) {
    throw new Error("Tokenless reveal payload contains an invalid address.");
  }
  if (size(responseHash) !== 32 || size(salt) !== 32) {
    throw new Error("Tokenless reveal payload hashes must be 32 bytes.");
  }

  return {
    roundId,
    voteKey,
    vote,
    predictedUpBps,
    responseHash,
    payoutAddress,
    salt,
  };
}

export function revealPayloadBytes(payload: Hex): Uint8Array {
  return hexToBytes(payload);
}
