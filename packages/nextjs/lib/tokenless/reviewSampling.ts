import { createHmac } from "node:crypto";
import "server-only";

export type ReviewSamplerDomain = "rateloop-adaptive-sample-v1" | "rateloop-fixed-sample-v1";

export function createDeterministicReviewSample(input: {
  domain: ReviewSamplerDomain;
  samplerKey: Buffer;
  samplerKeyVersion: string;
  policyVersion: number;
  scopeId: string;
  opportunityId: string;
}) {
  const manifest = [
    input.domain,
    input.samplerKeyVersion,
    String(input.policyVersion),
    input.scopeId,
    input.opportunityId,
  ].join(":");
  const digest = createHmac("sha256", input.samplerKey).update(manifest).digest("hex");

  return {
    sampleBucket: Number(BigInt(`0x${digest.slice(0, 16)}`) % 10_000n),
    samplerCommitment: `sha256:${digest}` as const,
  };
}
