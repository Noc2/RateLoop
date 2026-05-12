import { keccak256, stringToHex, type Hex } from "viem";
import type { Logger } from "./logger.js";
import { incrementCounter } from "./metrics.js";
import type { DetectorPipelineResult } from "./detectors/types.js";
import type { LatestProbeResultState, ProbeCandidateHint, StoredDeclarationState } from "./types.js";

export interface StoredArtifactRecord {
  kind: "probe-result" | "behavioral-drift";
  hash: Hex;
  storageKey: string;
  payload: string;
  metadata: Record<string, unknown>;
}

export interface ProbeArtifactStore {
  store(record: StoredArtifactRecord): Promise<void>;
}

export function createLogArtifactStore(logger: Logger): ProbeArtifactStore {
  return {
    async store(record: StoredArtifactRecord) {
      incrementCounter("prober_artifacts_stored_total");
      logger.info("Stored probe artifact", {
        kind: record.kind,
        hash: record.hash,
        storageKey: record.storageKey,
        ...record.metadata,
      });
    },
  };
}

export function createMemoryArtifactStore() {
  const records: StoredArtifactRecord[] = [];

  return {
    records,
    store: async (record: StoredArtifactRecord) => {
      records.push(record);
    },
  };
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return Object.fromEntries(entries.map(([key, entryValue]) => [key, normalizeValue(entryValue)]));
  }

  return value;
}

function hashPayload(payload: Record<string, unknown>): { hash: Hex; serialized: string } {
  const serialized = JSON.stringify(normalizeValue(payload));
  return {
    serialized,
    hash: keccak256(stringToHex(serialized)),
  };
}

export function buildProbeResultArtifact(params: {
  candidate: ProbeCandidateHint;
  storedDeclaration: StoredDeclarationState;
  latestProbeResult: LatestProbeResultState;
  evaluation: DetectorPipelineResult;
  detectorBundleHash: Hex;
  probeLibraryHash: Hex;
}): StoredArtifactRecord {
  const payload = {
    schemaVersion: 1,
    kind: "probe-result",
    rater: params.storedDeclaration.declaration.rater,
    operator: params.storedDeclaration.declaration.operator,
    version: params.storedDeclaration.declaration.version,
    source: params.candidate.source,
    declarationHash: params.storedDeclaration.declarationHash,
    previousProbeResultHash: params.latestProbeResult.resultHash,
    detectorBundleHash: params.detectorBundleHash,
    probeLibraryHash: params.probeLibraryHash,
    evaluation: {
      kind: params.evaluation.kind,
      passed: params.evaluation.passed,
      confidenceBps: params.evaluation.confidenceBps,
      summary: params.evaluation.summary,
      signals: params.evaluation.signals,
    },
  };
  const { hash, serialized } = hashPayload(payload);

  return {
    kind: "probe-result",
    hash,
    payload: serialized,
    storageKey: `probe-result/${hash}`,
    metadata: {
      rater: params.storedDeclaration.declaration.rater,
      version: params.storedDeclaration.declaration.version,
      passed: params.evaluation.passed,
      confidenceBps: params.evaluation.confidenceBps,
      source: params.candidate.source,
    },
  };
}

export function buildBehavioralDriftArtifact(params: {
  candidate: ProbeCandidateHint;
  storedDeclaration: StoredDeclarationState;
  evaluation: DetectorPipelineResult;
  detectorBundleHash: Hex;
  probeLibraryHash: Hex;
}): StoredArtifactRecord {
  const payload = {
    schemaVersion: 1,
    kind: "behavioral-drift",
    rater: params.storedDeclaration.declaration.rater,
    operator: params.storedDeclaration.declaration.operator,
    version: params.storedDeclaration.declaration.version,
    source: params.candidate.source,
    declarationHash: params.storedDeclaration.declarationHash,
    detectorBundleHash: params.detectorBundleHash,
    probeLibraryHash: params.probeLibraryHash,
    driftScoreBps: params.evaluation.driftScoreBps ?? 0,
    summary: params.evaluation.summary,
    signals: params.evaluation.signals,
  };
  const { hash, serialized } = hashPayload(payload);

  return {
    kind: "behavioral-drift",
    hash,
    payload: serialized,
    storageKey: `behavioral-drift/${hash}`,
    metadata: {
      rater: params.storedDeclaration.declaration.rater,
      version: params.storedDeclaration.declaration.version,
      driftScoreBps: params.evaluation.driftScoreBps ?? 0,
      source: params.candidate.source,
    },
  };
}
