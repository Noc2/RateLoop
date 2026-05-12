import { ZERO_HASH } from "../types.js";
import type { DetectorContext, DetectorSignal, ProbeDetector } from "./types.js";

function hasHash(value: string): boolean {
  return value.toLowerCase() !== ZERO_HASH.toLowerCase();
}

export class DeterministicMockDetector implements ProbeDetector {
  readonly id = "mock-metadata";

  async run(context: DetectorContext): Promise<DetectorSignal> {
    const declaration = context.storedDeclaration.declaration;
    const coreHashes = [declaration.modelId, declaration.provider, declaration.promptTemplateHash];
    const supportHashes = [declaration.endpointHint, declaration.retrievalConfigHash, declaration.toolingHash];
    const coreComplete = coreHashes.every(hasHash);
    const supportSignals = supportHashes.filter(hasHash).length;

    const confidenceBps = coreComplete
      ? Math.min(9_500, 7_000 + supportSignals * 600 + (declaration.disclosure > 0 ? 400 : 0))
      : Math.min(6_000, 3_000 + supportSignals * 500);

    return {
      detectorId: this.id,
      passed: coreComplete,
      confidenceBps,
      summary: coreComplete
        ? "core declaration hashes are present"
        : "missing one or more core declaration hashes",
      metadata: {
        coreComplete,
        supportSignals,
        disclosure: declaration.disclosure,
        modelClass: declaration.modelClass,
        previousProbePassed: context.latestProbeResult.passed,
      },
    };
  }
}
