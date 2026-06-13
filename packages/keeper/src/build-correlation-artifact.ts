import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildConfiguredCorrelationSnapshotArtifactForCandidates } from "./correlation-artifact-builder.js";
import { createLogger } from "./logger.js";

const { values } = parseArgs({
  options: {
    domain: { type: "string" },
    "reward-pool-id": { type: "string" },
    "content-id": { type: "string" },
    "round-id": { type: "string" },
    out: { type: "string" },
  },
});

function requirePositiveBigInt(value: string | undefined, label: string): bigint {
  if (!value || !/^\d+$/u.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function requireNonNegativeBigInt(value: string | undefined, label: string): bigint {
  if (!value || !/^\d+$/u.test(value)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return BigInt(value);
}

function requirePositiveNumber(value: string | undefined, label: string): number {
  if (!value || !/^\d+$/u.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

const out = values.out;
if (!out) throw new Error("--out is required");

const logger = createLogger(process.env.LOG_FORMAT === "text" ? "text" : "json");
const built = await buildConfiguredCorrelationSnapshotArtifactForCandidates(
  [
    {
      domain: requirePositiveNumber(values.domain, "--domain"),
      rewardPoolId: requireNonNegativeBigInt(values["reward-pool-id"], "--reward-pool-id"),
      contentId: requirePositiveBigInt(values["content-id"], "--content-id"),
      roundId: requirePositiveBigInt(values["round-id"], "--round-id"),
    },
  ],
  logger,
);

await writeFile(out, `${JSON.stringify(built.artifact)}\n`, "utf8");
console.log(
  JSON.stringify({
    out,
    candidateCount: built.candidateCount,
    roundSnapshotCount: built.roundSnapshotCount,
    epochCount: built.epochCount,
    artifactHash: built.artifactHash ?? null,
  }),
);
