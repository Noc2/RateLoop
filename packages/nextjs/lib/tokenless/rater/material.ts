import {
  type TokenlessPredictionBps,
  type TokenlessRaterRoundSecrets,
  type TokenlessRevealMaterial,
  type TokenlessVote,
  isTokenlessPredictionBps,
} from "./types";
import {
  type Address,
  type Hex,
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbiParameters,
  size,
  zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const TOKENLESS_REVEAL_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "Reveal(uint256 roundId,address voteKey,uint8 vote,uint16 predictedUpBps,bytes32 responseHash,address payoutAddress,bytes32 salt)",
  ),
);

export const TOKENLESS_REVEAL_PAYLOAD_MAGIC = "0x524c5431" as const;
export const TOKENLESS_REVEAL_PAYLOAD_VERSION = 1;
export const TOKENLESS_MAX_REVEAL_PLAINTEXT_BYTES = 1024;

const REVEAL_PARAMETERS = parseAbiParameters(
  "bytes4 magic,uint8 version,uint256 roundId,address voteKey,uint8 vote,uint16 predictedUpBps,bytes32 responseHash,address payoutAddress,bytes32 salt",
);
const REVEAL_COMMITMENT_PARAMETERS = parseAbiParameters(
  "bytes32 typehash,uint256 roundId,address voteKey,uint8 vote,uint16 predictedUpBps,bytes32 responseHash,address payoutAddress,bytes32 salt",
);
const PAYOUT_COMMITMENT_PARAMETERS = parseAbiParameters("address payoutAddress,bytes32 salt");

function assertBytes32(value: Hex, label: string): void {
  if (!isHex(value, { strict: true }) || size(value) !== 32) {
    throw new Error(`${label} must be exactly 32 bytes.`);
  }
}

function assertPrivateKey(value: Hex, label: string): Address {
  assertBytes32(value, label);
  try {
    return privateKeyToAccount(value).address;
  } catch {
    throw new Error(`${label} is not a valid secp256k1 private key.`);
  }
}

export function validateTokenlessRevealMaterial(material: TokenlessRevealMaterial): void {
  if (material.roundId <= 0n) throw new Error("roundId must be positive.");
  if (!isAddress(material.voteKey) || getAddress(material.voteKey) === zeroAddress) {
    throw new Error("voteKey must be a non-zero address.");
  }
  if (!isAddress(material.payoutAddress) || getAddress(material.payoutAddress) === zeroAddress) {
    throw new Error("payoutAddress must be a non-zero address.");
  }
  if (material.vote !== 0 && material.vote !== 1) throw new Error("vote must be 0 or 1.");
  if (!isTokenlessPredictionBps(material.predictedUpBps)) {
    throw new Error("predictedUpBps must use the 100..9900 one-percent grid.");
  }
  assertBytes32(material.responseHash, "responseHash");
  assertBytes32(material.salt, "salt");
}

export function validateTokenlessRaterRoundSecrets(secrets: TokenlessRaterRoundSecrets): void {
  if (secrets.schemaVersion !== "rateloop.tokenless.rater-secrets.v1") {
    throw new Error("Unsupported tokenless rater secrets version.");
  }
  validateTokenlessRevealMaterial(secrets.reveal);
  const voteKey = assertPrivateKey(secrets.votePrivateKey, "votePrivateKey");
  const payoutAddress = assertPrivateKey(secrets.payoutPrivateKey, "payoutPrivateKey");
  if (getAddress(voteKey) !== getAddress(secrets.reveal.voteKey)) {
    throw new Error("votePrivateKey does not control voteKey.");
  }
  if (getAddress(payoutAddress) !== getAddress(secrets.reveal.payoutAddress)) {
    throw new Error("payoutPrivateKey does not control payoutAddress.");
  }
  if (secrets.votePrivateKey.toLowerCase() === secrets.payoutPrivateKey.toLowerCase()) {
    throw new Error("Vote and payout keys must be independent.");
  }
}

export function createTokenlessRaterRoundSecrets(params: {
  roundId: bigint;
  vote: TokenlessVote;
  predictedUpBps: TokenlessPredictionBps;
  responseHash: Hex;
}): TokenlessRaterRoundSecrets {
  const votePrivateKey = generatePrivateKey();
  let payoutPrivateKey = generatePrivateKey();
  while (payoutPrivateKey === votePrivateKey) payoutPrivateKey = generatePrivateKey();
  const salt = generatePrivateKey();
  const secrets: TokenlessRaterRoundSecrets = {
    schemaVersion: "rateloop.tokenless.rater-secrets.v1",
    votePrivateKey,
    payoutPrivateKey,
    reveal: {
      roundId: params.roundId,
      voteKey: privateKeyToAccount(votePrivateKey).address,
      vote: params.vote,
      predictedUpBps: params.predictedUpBps,
      responseHash: params.responseHash,
      payoutAddress: privateKeyToAccount(payoutPrivateKey).address,
      salt,
    },
  };
  validateTokenlessRaterRoundSecrets(secrets);
  return secrets;
}

export function encodeTokenlessRevealPayload(material: TokenlessRevealMaterial): Hex {
  validateTokenlessRevealMaterial(material);
  const encoded = encodeAbiParameters(REVEAL_PARAMETERS, [
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
  if (size(encoded) > TOKENLESS_MAX_REVEAL_PLAINTEXT_BYTES) {
    throw new Error("Tokenless reveal payload exceeds its protocol size bound.");
  }
  return encoded;
}

export function tokenlessPayoutCommitment(payoutAddress: Address, salt: Hex): Hex {
  if (!isAddress(payoutAddress) || getAddress(payoutAddress) === zeroAddress) {
    throw new Error("payoutAddress must be a non-zero address.");
  }
  assertBytes32(salt, "salt");
  return keccak256(encodeAbiParameters(PAYOUT_COMMITMENT_PARAMETERS, [payoutAddress, salt]));
}

export function tokenlessRevealCommitment(material: TokenlessRevealMaterial): Hex {
  validateTokenlessRevealMaterial(material);
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
