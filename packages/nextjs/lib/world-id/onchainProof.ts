import type { IDKitResult, ResponseItemV4 } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { type Hex, hexToBigInt, isHex } from "viem";
import type { WorldIdCredentialIdentifier } from "~~/lib/world-id/credentials";

type WorldIdV4ProofTuple = [bigint, bigint, bigint, bigint, bigint];

type V4ProofResponse = {
  identifier: string;
  proof: [string, string, string, string, string];
  nullifier: string;
  signal_hash: string;
  issuer_schema_id: number;
  expires_at_min: number;
};

export type WorldIdV4OnchainProof = {
  protocolVersion: "4.0";
  nullifierHash: bigint;
  proof: WorldIdV4ProofTuple;
  nullifier: string;
  nonce: bigint;
  signalHash: string;
  issuerSchemaId: number;
  expiresAtMin: number;
};

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

function requireHex(value: unknown, fieldName: string): Hex {
  if (typeof value !== "string") {
    throw new Error(`World ID returned an invalid ${fieldName}.`);
  }

  if (!isHex(value)) {
    throw new Error(`World ID returned an invalid ${fieldName}.`);
  }

  return value;
}

function decodeV4Proof(proof: V4ProofResponse["proof"]): WorldIdV4ProofTuple {
  const decoded = proof.map((item, index) => hexToBigInt(requireHex(item, `v4 proof item ${index}`)));
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
    nullifierHash: hexToBigInt(requireHex(response.nullifier, "nullifier")),
    proof: decodeV4Proof(response.proof),
    nullifier: response.nullifier,
    nonce: hexToBigInt(requireHex(result.nonce, "nonce")),
    signalHash: response.signal_hash,
    issuerSchemaId: response.issuer_schema_id,
    expiresAtMin: response.expires_at_min,
  };
}

export const parseWorldIdProof = parseWorldIdV4Proof;
