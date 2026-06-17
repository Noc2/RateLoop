import type { WorldIdProofMode } from "./config";
import type { IDKitResult, ResponseItemV3, ResponseItemV4 } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { type Hex, decodeAbiParameters, hexToBigInt, isHex } from "viem";
import type { WorldIdCredentialIdentifier } from "~~/lib/world-id/credentials";

type WorldIdProofTuple = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
type WorldIdV4ProofTuple = [bigint, bigint, bigint, bigint, bigint];
const UINT256_MAX = (1n << 256n) - 1n;
const DECIMAL_UINT_PATTERN = /^(0|[1-9]\d*)$/;

type LegacyProofResponse = ResponseItemV3 & {
  identifier: string;
  proof: string;
  merkle_root: string;
  nullifier: string;
  signal_hash: string;
};

type V4ProofResponse = {
  identifier: string;
  proof: [string, string, string, string, string];
  nullifier: string;
  signal_hash: string;
  issuer_schema_id: number;
  expires_at_min: number;
};

type WorldIdLegacyOnchainProof = {
  protocolVersion: "3.0";
  root: bigint;
  nullifierHash: bigint;
  proof: WorldIdProofTuple;
  nullifier: string;
  signalHash: string;
};

type WorldIdV4OnchainProof = {
  protocolVersion: "4.0";
  nullifierHash: bigint;
  proof: WorldIdV4ProofTuple;
  nullifier: string;
  nonce: bigint;
  signalHash: string;
  issuerSchemaId: number;
  expiresAtMin: number;
};

type WorldIdOnchainProof = WorldIdLegacyOnchainProof | WorldIdV4OnchainProof;

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

function isV4Response(response: unknown): response is V4ProofResponse {
  if (!response || typeof response !== "object") {
    return false;
  }

  const candidate = response as Partial<ResponseItemV4>;
  return (
    typeof candidate.identifier === "string" &&
    Array.isArray(candidate.proof) &&
    candidate.proof.length === 5 &&
    candidate.proof.every(item => typeof item === "string") &&
    typeof candidate.nullifier === "string" &&
    typeof candidate.signal_hash === "string" &&
    typeof candidate.issuer_schema_id === "number" &&
    typeof candidate.expires_at_min === "number"
  );
}

function requireHex(value: string, fieldName: string): Hex {
  if (!isHex(value)) {
    throw new Error(`World ID returned an invalid ${fieldName}.`);
  }

  return value;
}

function decodeUint256String(value: unknown, fieldName: string): bigint {
  if (typeof value !== "string") {
    throw new Error(`World ID returned an invalid ${fieldName}.`);
  }

  const decoded = isHex(value) ? hexToBigInt(value) : DECIMAL_UINT_PATTERN.test(value) ? BigInt(value) : null;
  if (decoded === null || decoded > UINT256_MAX) {
    throw new Error(`World ID returned an invalid ${fieldName}.`);
  }

  return decoded;
}

function decodeProof(proof: string): WorldIdProofTuple {
  const decoded = decodeAbiParameters([{ type: "uint256[8]" }], requireHex(proof, "proof"))[0];
  return [...decoded] as WorldIdProofTuple;
}

function decodeV4Proof(proof: V4ProofResponse["proof"]): WorldIdV4ProofTuple {
  const decoded = proof.map((item, index) => decodeUint256String(item, `v4 proof item ${index}`));
  return decoded as WorldIdV4ProofTuple;
}

function assertExpectedAction(result: IDKitResult, expectedAction: string) {
  if ("session_id" in result) {
    throw new Error("RateLoop on-chain verification requires a World ID uniqueness proof.");
  }

  if (result.action !== expectedAction) {
    throw new Error("World ID action does not match this deployment.");
  }
}

function assertSignalHash(signalHash: string, expectedSignal: string) {
  const expectedSignalHash = hashSignal(expectedSignal).toLowerCase();
  if (signalHash.toLowerCase() !== expectedSignalHash) {
    throw new Error("World ID proof is not bound to the connected wallet.");
  }
}

export function parseWorldIdLegacyProof(
  result: IDKitResult,
  options: { expectedAction: string; expectedSignal: string },
): WorldIdLegacyOnchainProof {
  if (result.protocol_version !== "3.0") {
    throw new Error("RateLoop on-chain verification requires a World ID 3.0 legacy proof.");
  }

  assertExpectedAction(result, options.expectedAction);

  const response = result.responses.find(isLegacyResponse);
  if (!response) {
    throw new Error("World ID did not return an on-chain proof.");
  }

  assertSignalHash(response.signal_hash, options.expectedSignal);

  return {
    protocolVersion: "3.0",
    root: hexToBigInt(requireHex(response.merkle_root, "Merkle root")),
    nullifierHash: hexToBigInt(requireHex(response.nullifier, "nullifier")),
    proof: decodeProof(response.proof),
    nullifier: response.nullifier,
    signalHash: response.signal_hash,
  };
}

export function parseWorldIdV4Proof(
  result: IDKitResult,
  options: {
    expectedAction: string;
    expectedCredential?: WorldIdCredentialIdentifier;
    expectedSignal: string;
  },
): WorldIdV4OnchainProof {
  if (result.protocol_version !== "4.0" || "session_id" in result) {
    throw new Error("RateLoop on-chain verification requires a World ID 4.0 uniqueness proof.");
  }

  assertExpectedAction(result, options.expectedAction);

  const response = result.responses.find(
    (candidate): candidate is V4ProofResponse =>
      isV4Response(candidate) && (!options.expectedCredential || candidate.identifier === options.expectedCredential),
  );
  if (!response) {
    throw new Error("World ID did not return the requested v4 on-chain proof.");
  }

  assertSignalHash(response.signal_hash, options.expectedSignal);

  return {
    protocolVersion: "4.0",
    nullifierHash: decodeUint256String(response.nullifier, "nullifier"),
    proof: decodeV4Proof(response.proof),
    nullifier: response.nullifier,
    nonce: decodeUint256String(result.nonce, "nonce"),
    signalHash: response.signal_hash,
    issuerSchemaId: response.issuer_schema_id,
    expiresAtMin: response.expires_at_min,
  };
}

export function parseWorldIdProof(
  result: IDKitResult,
  options: {
    expectedAction: string;
    expectedCredential?: WorldIdCredentialIdentifier;
    expectedSignal: string;
    proofMode: WorldIdProofMode;
  },
): WorldIdOnchainProof {
  if (result.protocol_version === "3.0") {
    if (options.proofMode === "v4") {
      throw new Error("World ID proof mode is v4-only, but World ID returned a legacy proof.");
    }

    return parseWorldIdLegacyProof(result, options);
  }

  if (result.protocol_version === "4.0") {
    if (options.proofMode === "legacy") {
      throw new Error("World ID legacy proof mode cannot submit a World ID 4.0 proof.");
    }

    return parseWorldIdV4Proof(result, options);
  }

  throw new Error("World ID returned an unsupported proof version.");
}
