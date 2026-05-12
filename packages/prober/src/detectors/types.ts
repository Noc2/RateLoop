import type { Hex } from "viem";
import type { LatestProbeResultState, ProbeCandidateHint, StoredDeclarationState } from "../types.js";

export interface DetectorContext {
  candidate: ProbeCandidateHint;
  storedDeclaration: StoredDeclarationState;
  latestProbeResult: LatestProbeResultState;
  detectorBundleHash: Hex;
  probeLibraryHash: Hex;
}

export interface DetectorSignal {
  detectorId: string;
  passed: boolean;
  confidenceBps: number;
  driftScoreBps?: number;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface DetectorPipelineResult {
  kind: string;
  passed: boolean;
  confidenceBps: number;
  driftScoreBps?: number;
  summary: string;
  signals: DetectorSignal[];
}

export interface ProbeDetector {
  readonly id: string;
  run(context: DetectorContext): Promise<DetectorSignal>;
}

export interface ProbeDetectorPipeline {
  evaluate(context: DetectorContext): Promise<DetectorPipelineResult>;
}
