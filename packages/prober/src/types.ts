import type { Address, Hex } from "viem";

export const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;

export type ProbeCandidateSource = "declaration-scan" | "recent-declaration" | "probe-requested";

export interface RaterDeclarationState {
  rater: Address;
  operator: Address;
  modelClass: number;
  modelId: Hex;
  provider: Hex;
  endpointHint: Hex;
  promptTemplateHash: Hex;
  retrievalConfigHash: Hex;
  toolingHash: Hex;
  version: number;
  effectiveEpoch: bigint;
  expiresAtEpoch: bigint;
  disclosure: number;
  nonce: bigint;
}

export interface StoredDeclarationState {
  declaration: RaterDeclarationState;
  tier: number;
  declaredAt: bigint;
  probePending: boolean;
  declarationHash: Hex;
  lastProbeResultHash: Hex;
}

export interface LatestProbeResultState {
  probeLibraryHash: Hex;
  resultHash: Hex;
  confidenceBps: number;
  recordedAt: bigint;
  passed: boolean;
}

export interface ProbeCandidateHint {
  rater: Address;
  hintVersion?: number;
  declarationHash?: Hex;
  source: ProbeCandidateSource;
  discoveredAtBlock?: bigint;
}

export interface ProbeScanState {
  discoveredCandidates: number;
  pendingCount: number;
  latestBlock: bigint;
  lastScannedBlock: bigint;
}

export interface ProberRunResult {
  candidatesDiscovered: number;
  candidatesProcessed: number;
  candidatesSkipped: number;
  probeResultsRecorded: number;
  driftFlagsRecorded: number;
  failedDetections: number;
  pendingCount: number;
  latestBlock: bigint;
  lastScannedBlock: bigint;
}
