import { tokenlessPayoutCommitment, tokenlessRevealCommitment, validateTokenlessRaterRoundSecrets } from "./material";
import type { TokenlessCommitAuthorization, TokenlessDrandNetwork, TokenlessRaterRoundSecrets } from "./types";
import {
  type Address,
  type Hex,
  getAddress,
  hashTypedData,
  isAddress,
  isHex,
  keccak256,
  size,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const TOKENLESS_PANEL_EIP712_NAME = "RateLoop Tokenless Panel";
export const TOKENLESS_PANEL_EIP712_VERSION = "1";

export const TOKENLESS_COMMIT_TYPES = {
  Commit: [
    { name: "roundId", type: "uint256" },
    { name: "sealedCommitment", type: "bytes32" },
    { name: "sealedPayloadHash", type: "bytes32" },
    { name: "payoutCommitment", type: "bytes32" },
    { name: "nullifier", type: "bytes32" },
  ],
} as const;

function assertBytes32(value: Hex, label: string): void {
  if (!isHex(value, { strict: true }) || size(value) !== 32) {
    throw new Error(`${label} must be exactly 32 bytes.`);
  }
}

export function tokenlessCommitTypedData(params: {
  chainId: number;
  panelAddress: Address;
  roundId: bigint;
  sealedCommitment: Hex;
  sealedPayloadHash: Hex;
  payoutCommitment: Hex;
  nullifier: Hex;
}) {
  if (!Number.isSafeInteger(params.chainId) || params.chainId <= 0) {
    throw new Error("chainId must be a positive safe integer.");
  }
  if (!isAddress(params.panelAddress) || getAddress(params.panelAddress) === zeroAddress) {
    throw new Error("panelAddress must be a non-zero address.");
  }
  if (params.roundId <= 0n) throw new Error("roundId must be positive.");
  assertBytes32(params.sealedCommitment, "sealedCommitment");
  assertBytes32(params.sealedPayloadHash, "sealedPayloadHash");
  assertBytes32(params.payoutCommitment, "payoutCommitment");
  assertBytes32(params.nullifier, "nullifier");
  return {
    domain: {
      name: TOKENLESS_PANEL_EIP712_NAME,
      version: TOKENLESS_PANEL_EIP712_VERSION,
      chainId: params.chainId,
      verifyingContract: params.panelAddress,
    },
    types: TOKENLESS_COMMIT_TYPES,
    primaryType: "Commit" as const,
    message: {
      roundId: params.roundId,
      sealedCommitment: params.sealedCommitment,
      sealedPayloadHash: params.sealedPayloadHash,
      payoutCommitment: params.payoutCommitment,
      nullifier: params.nullifier,
    },
  };
}

export function tokenlessCommitDigest(params: Parameters<typeof tokenlessCommitTypedData>[0]): Hex {
  return hashTypedData(tokenlessCommitTypedData(params));
}

/**
 * Produces the only rater authorization consumed by TokenlessPanel.commit.
 * TokenlessPanel.reveal is permissionless and validates the reveal preimage,
 * so inventing a second reveal signature would provide no on-chain security.
 */
export async function signTokenlessCommit(params: {
  secrets: TokenlessRaterRoundSecrets;
  sealedPayload: Hex;
  drandNetwork: TokenlessDrandNetwork;
  beaconRound: number;
  chainId: number;
  panelAddress: Address;
  nullifier: Hex;
}): Promise<TokenlessCommitAuthorization> {
  validateTokenlessRaterRoundSecrets(params.secrets);
  if (!isHex(params.sealedPayload, { strict: true }) || size(params.sealedPayload) === 0) {
    throw new Error("sealedPayload must contain the tlock ciphertext bytes.");
  }
  if (!Number.isSafeInteger(params.beaconRound) || params.beaconRound <= 0) {
    throw new Error("beaconRound must be a positive safe integer.");
  }
  const sealedPayloadHash = keccak256(params.sealedPayload);
  const sealedCommitment = tokenlessRevealCommitment(params.secrets.reveal);
  const payoutCommitment = tokenlessPayoutCommitment(params.secrets.reveal.payoutAddress, params.secrets.reveal.salt);
  const typedData = tokenlessCommitTypedData({
    chainId: params.chainId,
    panelAddress: params.panelAddress,
    roundId: params.secrets.reveal.roundId,
    sealedCommitment,
    sealedPayloadHash,
    payoutCommitment,
    nullifier: params.nullifier,
  });
  const account = privateKeyToAccount(params.secrets.votePrivateKey);
  const voteKeySignature = await account.signTypedData(typedData);
  return {
    roundId: params.secrets.reveal.roundId,
    drandNetwork: params.drandNetwork,
    beaconRound: params.beaconRound,
    sealedPayload: params.sealedPayload,
    sealedPayloadHash,
    sealedCommitment,
    payoutCommitment,
    panelAddress: getAddress(params.panelAddress),
    chainId: params.chainId,
    nullifier: params.nullifier,
    voteKey: account.address,
    voteKeySignature,
  };
}

export function tokenlessSelfRevealArguments(secrets: TokenlessRaterRoundSecrets) {
  validateTokenlessRaterRoundSecrets(secrets);
  const reveal = secrets.reveal;
  return [
    reveal.roundId,
    reveal.voteKey,
    reveal.vote,
    reveal.predictedUpBps,
    reveal.responseHash,
    reveal.payoutAddress,
    reveal.salt,
  ] as const;
}
