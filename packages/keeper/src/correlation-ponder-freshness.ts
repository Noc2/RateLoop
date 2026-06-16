import type { PublicClient } from "viem";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { config } from "./config.js";
import { readRound } from "./contract-reads.js";
import type { CorrelationRoundCandidate } from "./correlation-artifact-builder.js";
import type { Logger } from "./logger.js";

const PONDER_FETCH_TIMEOUT_MS = 15_000;
const PONDER_JSON_MAX_BYTES = 5_000_000;

interface PonderRoundListResponse {
  items?: Array<{ roundId?: unknown; revealedCount?: unknown; voteCount?: unknown; state?: unknown }>;
}

interface PonderCorrelationRoundVotesResponse {
  items?: unknown[];
}

async function fetchPonderCorrelationRevealedVoteCount(
  ponderBaseUrl: string,
  rewardPoolId: bigint,
  contentId: bigint,
  roundId: bigint,
  expectedCount: bigint,
): Promise<number | null> {
  if (expectedCount <= 0n) {
    return 0;
  }
  const limit = Number(expectedCount > 1000n ? 1000n : expectedCount);
  const url = new URL("/correlation/round-votes", ponderBaseUrl);
  url.searchParams.set("rewardPoolId", rewardPoolId.toString());
  url.searchParams.set("contentId", contentId.toString());
  url.searchParams.set("roundId", roundId.toString());
  url.searchParams.set("limit", String(limit));
  const response = await fetchPonderJson<PonderCorrelationRoundVotesResponse>(url);
  const count = (response.items ?? []).length;
  if (expectedCount > BigInt(limit) && count >= limit) {
    return count;
  }
  return count;
}

function parseBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

async function fetchPonderJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(PONDER_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Ponder request failed: ${url.pathname} ${response.status}`);
  }
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredLength = Number.parseInt(contentLengthHeader, 10);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > PONDER_JSON_MAX_BYTES
    ) {
      throw new Error(
        `Ponder response too large: ${declaredLength} > ${PONDER_JSON_MAX_BYTES} bytes`,
      );
    }
  }
  return (await response.json()) as T;
}

async function fetchPonderRoundSnapshot(
  ponderBaseUrl: string,
  contentId: bigint,
  roundId: bigint,
): Promise<{ revealedCount: bigint; voteCount: bigint; state: number } | null> {
  const url = new URL("/rounds", ponderBaseUrl);
  url.searchParams.set("contentId", contentId.toString());
  url.searchParams.set("roundId", roundId.toString());
  url.searchParams.set("limit", "1");
  const response = await fetchPonderJson<PonderRoundListResponse>(url);
  const match = (response.items ?? [])[0];
  if (!match) {
    return null;
  }
  const revealedCount = parseBigInt(match.revealedCount);
  const voteCount = parseBigInt(match.voteCount);
  const state = typeof match.state === "number" ? match.state : Number(match.state);
  if (
    revealedCount === null ||
    revealedCount < 0n ||
    voteCount === null ||
    voteCount < 0n ||
    !Number.isFinite(state)
  ) {
    return null;
  }
  return { revealedCount, voteCount, state };
}

export async function areCorrelationCandidatesPonderFresh(
  publicClient: Pick<PublicClient, "readContract">,
  candidates: readonly CorrelationRoundCandidate[],
  logger: Logger,
): Promise<boolean> {
  if (candidates.length === 0 || !config.ponderBaseUrl) {
    return true;
  }

  const engine = config.contracts.votingEngine;
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.contentId}:${candidate.roundId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const chainRound = await readRound(
      publicClient,
      engine,
      candidate.contentId,
      candidate.roundId,
    );
    const ponderRound = await fetchPonderRoundSnapshot(
      config.ponderBaseUrl,
      candidate.contentId,
      candidate.roundId,
    );
    if (ponderRound === null) {
      logger.debug("Deferring correlation artifact build until Ponder indexes round", {
        contentId: candidate.contentId.toString(),
        roundId: candidate.roundId.toString(),
      });
      return false;
    }
    if (
      chainRound.state === ROUND_STATE.Settled &&
      ponderRound.state !== ROUND_STATE.Settled
    ) {
      logger.debug("Deferring correlation artifact build until Ponder marks round settled", {
        contentId: candidate.contentId.toString(),
        roundId: candidate.roundId.toString(),
        chainState: chainRound.state,
        ponderState: ponderRound.state,
      });
      return false;
    }
    if (ponderRound.revealedCount < chainRound.revealedCount) {
      logger.debug(
        "Deferring correlation artifact build until Ponder reflects revealed vote count",
        {
          contentId: candidate.contentId.toString(),
          roundId: candidate.roundId.toString(),
          chainRevealedCount: chainRound.revealedCount.toString(),
          ponderRevealedCount: ponderRound.revealedCount.toString(),
        },
      );
      return false;
    }
    if (ponderRound.voteCount < chainRound.voteCount) {
      logger.debug("Deferring correlation artifact build until Ponder reflects vote count", {
        contentId: candidate.contentId.toString(),
        roundId: candidate.roundId.toString(),
        chainVoteCount: chainRound.voteCount.toString(),
        ponderVoteCount: ponderRound.voteCount.toString(),
      });
      return false;
    }
    if (
      chainRound.state === ROUND_STATE.Settled &&
      chainRound.revealedCount > 0n
    ) {
      const ponderCorrelationVotes = await fetchPonderCorrelationRevealedVoteCount(
        config.ponderBaseUrl,
        candidate.rewardPoolId,
        candidate.contentId,
        candidate.roundId,
        chainRound.revealedCount,
      );
      if (
        ponderCorrelationVotes === null ||
        BigInt(ponderCorrelationVotes) < chainRound.revealedCount
      ) {
        logger.debug(
          "Deferring correlation artifact build until Ponder indexes correlation-eligible revealed votes",
          {
            contentId: candidate.contentId.toString(),
            roundId: candidate.roundId.toString(),
            chainRevealedCount: chainRound.revealedCount.toString(),
            ponderCorrelationVoteCount: ponderCorrelationVotes?.toString() ?? "null",
          },
        );
        return false;
      }
    }
  }

  return true;
}
