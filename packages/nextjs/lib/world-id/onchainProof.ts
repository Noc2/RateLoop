import type { IDKitResult, ResponseItemV3 } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { type Hex, decodeAbiParameters, hexToBigInt, isHex } from "viem";

type WorldIdProofTuple = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
type LegacyProofResponse = ResponseItemV3 & {
  identifier: string;
  proof: string;
  merkle_root: string;
  nullifier: string;
  signal_hash: string;
};

type WorldIdOnchainProof = {
  root: bigint;
  nullifierHash: bigint;
  proof: WorldIdProofTuple;
  nullifier: string;
  signalHash: string;
};

function isLegacyResponse(response: unknown): response is LegacyProofResponse {
  if (!response || typeof response !== "object") {
    return false;
  }

  const candidate = response as Partial<ResponseItemV3>;
  return (
    typeof candidate.identifier === "string" &&
    typeof candidate.proof === "string" &&
    typeof candidate.merkle_root === "string" &&
    typeof candidate.nullifier === "string" &&
    typeof candidate.signal_hash === "string"
  );
}

function requireHex(value: string, fieldName: string): Hex {
  if (!isHex(value)) {
    throw new Error(`World ID returned an invalid ${fieldName}.`);
  }

  return value;
}

function decodeProof(proof: string): WorldIdProofTuple {
  const decoded = decodeAbiParameters([{ type: "uint256[8]" }], requireHex(proof, "proof"))[0];
  return [...decoded] as WorldIdProofTuple;
}

export function parseWorldIdLegacyProof(
  result: IDKitResult,
  options: { expectedAction: string; expectedSignal: string },
): WorldIdOnchainProof {
  if (result.protocol_version !== "3.0") {
    throw new Error("RateLoop on-chain verification requires a World ID 3.0 legacy proof.");
  }

  if (result.action !== options.expectedAction) {
    throw new Error("World ID action does not match this deployment.");
  }

  const response = result.responses.find(isLegacyResponse);
  if (!response) {
    throw new Error("World ID did not return an on-chain proof.");
  }

  const expectedSignalHash = hashSignal(options.expectedSignal).toLowerCase();
  if (response.signal_hash.toLowerCase() !== expectedSignalHash) {
    throw new Error("World ID proof is not bound to the connected wallet.");
  }

  return {
    root: hexToBigInt(requireHex(response.merkle_root, "Merkle root")),
    nullifierHash: hexToBigInt(requireHex(response.nullifier, "nullifier")),
    proof: decodeProof(response.proof),
    nullifier: response.nullifier,
    signalHash: response.signal_hash,
  };
}
