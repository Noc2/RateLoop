import { DeterministicMockDetector } from "./mock-detector.js";
import type { DetectorContext, DetectorPipelineResult, ProbeDetector, ProbeDetectorPipeline } from "./types.js";

function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

export function buildDetectorPipeline(config: {
  detectorKind: "mock";
}): ProbeDetectorPipeline {
  const detectors: ProbeDetector[] = [];

  if (config.detectorKind === "mock") {
    detectors.push(new DeterministicMockDetector());
  }

  return {
    async evaluate(context: DetectorContext): Promise<DetectorPipelineResult> {
      const signals = await Promise.all(detectors.map(detector => detector.run(context)));
      const passed = signals.every(signal => signal.passed);
      const confidenceBps = clampBps(
        signals.length > 0 ? Math.min(...signals.map(signal => signal.confidenceBps)) : 0,
      );
      const driftScore = signals.reduce(
        (current, signal) => Math.max(current, clampBps(signal.driftScoreBps ?? 0)),
        0,
      );

      return {
        kind: config.detectorKind,
        passed,
        confidenceBps,
        driftScoreBps: driftScore > 0 ? driftScore : undefined,
        summary: signals.map(signal => `${signal.detectorId}: ${signal.summary}`).join("; "),
        signals,
      };
    },
  };
}
