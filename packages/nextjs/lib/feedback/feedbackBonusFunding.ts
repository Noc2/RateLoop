import { RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import type { Address } from "viem";

type FeedbackBonusRoundReadClient = {
  getBlock: (params: { blockTag: "latest" }) => Promise<{ timestamp: bigint }>;
  readContract: unknown;
};

export type FeedbackBonusRoundTarget = {
  feedbackClosesAt: bigint;
  roundId: bigint;
};

export class FeedbackBonusRoundTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackBonusRoundTargetError";
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parsePositiveInteger(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value ?? fallback));
}

function parseNonNegativeInteger(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value ?? fallback));
}

export async function resolveOpenFeedbackBonusRoundTarget(params: {
  client: FeedbackBonusRoundReadClient;
  contentId: bigint;
  durationSeconds: bigint;
  maxAttempts?: number;
  retryDelayMs?: number;
  votingEngineAddress: Address;
}): Promise<FeedbackBonusRoundTarget> {
  const maxAttempts = parsePositiveInteger(params.maxAttempts, 8);
  const retryDelayMs = parseNonNegativeInteger(params.retryDelayMs, 750);
  const readContract = params.client.readContract as (request: unknown) => Promise<unknown>;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const currentRoundId = (await readContract({
        address: params.votingEngineAddress,
        abi: RoundVotingEngineAbi,
        functionName: "currentRoundId",
        args: [params.contentId],
      })) as bigint;
      const roundId = currentRoundId > 0n ? currentRoundId : 1n;
      const roundCore = (await readContract({
        address: params.votingEngineAddress,
        abi: RoundVotingEngineAbi,
        functionName: "roundCore",
        args: [params.contentId, roundId],
      })) as any;
      const roundStartTime = BigInt(roundCore?.startTime ?? roundCore?.[0] ?? 0);
      const roundState = Number(roundCore?.state ?? roundCore?.[1] ?? -1);
      if (roundStartTime !== 0n && roundState === ROUND_STATE.Open) {
        const feedbackClosesAt = roundStartTime + params.durationSeconds;
        const latestBlock = await params.client.getBlock({ blockTag: "latest" });
        if (feedbackClosesAt <= latestBlock.timestamp) {
          throw new FeedbackBonusRoundTargetError("Feedback Bonus close time is in the past.");
        }
        return { feedbackClosesAt, roundId };
      }
    } catch (error) {
      if (error instanceof FeedbackBonusRoundTargetError) throw error;
    }

    if (attempt < maxAttempts && retryDelayMs > 0) {
      await delay(retryDelayMs);
    }
  }

  throw new FeedbackBonusRoundTargetError(
    "Feedback Bonus can only be funded while the submitted question round is open.",
  );
}
