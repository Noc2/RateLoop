import type { PublicClient } from "viem";
import {
  CORRELATION_VOTE_PAGE_SIZE,
  MAX_CORRELATION_VOTE_PAGES,
  PAYOUT_DOMAIN_PUBLIC_RATING,
  PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
  PONDER_HTTP_FETCH_TIMEOUT_MS,
  correlationVotesPathForDomain,
} from "@rateloop/node-utils/correlationScoring";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { config } from "./config.js";
import { readRound } from "./contract-reads.js";
import type { CorrelationRoundCandidate } from "./correlation-artifact-builder.js";
import { readBoundedResponseText } from "./bounded-response.js";
import type { Logger } from "./logger.js";
import { buildPonderUrl } from "./ponder-url.js";

const PONDER_FETCH_TIMEOUT_MS = PONDER_HTTP_FETCH_TIMEOUT_MS;
const PONDER_JSON_MAX_BYTES = 5_000_000;
const VOTE_PAGE_SIZE = CORRELATION_VOTE_PAGE_SIZE;
const MAX_VOTE_PAGES = MAX_CORRELATION_VOTE_PAGES;

interface PonderRoundListResponse {
  items?: Array<{ roundId?: unknown; revealedCount?: unknown; voteCount?: unknown; state?: unknown }>;
}

interface PonderCorrelationRoundVotesResponse {
  items?: unknown[];
  truncated?: boolean;
}

function buildCorrelationVotesUrl(
  ponderBaseUrl: string,
  candidate: CorrelationRoundCandidate,
  limit: number,
  offset: number,
  ponderNowSeconds?: bigint,
): URL {
  const url = buildPonderUrl(ponderBaseUrl, correlationVotesPathForDomain(candidate.domain));
  if (candidate.domain !== PAYOUT_DOMAIN_PUBLIC_RATING) {
    url.searchParams.set("rewardPoolId", candidate.rewardPoolId.toString());
  }
  url.searchParams.set("contentId", candidate.contentId.toString());
  url.searchParams.set("roundId", candidate.roundId.toString());
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (ponderNowSeconds !== undefined) {
    url.searchParams.set("now", ponderNowSeconds.toString());
  }
  return url;
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
  const body = await readBoundedResponseText(response, PONDER_JSON_MAX_BYTES, "Ponder");
  return JSON.parse(body) as T;
}

async function fetchPonderJsonOptional<T>(url: URL): Promise<T | null> {
  try {
    return await fetchPonderJson<T>(url);
  } catch {
    return null;
  }
}

async function fetchPonderRoundSnapshot(
  ponderBaseUrl: string,
  contentId: bigint,
  roundId: bigint,
): Promise<{ revealedCount: bigint; voteCount: bigint; state: number } | null> {
  const url = buildPonderUrl(ponderBaseUrl, "/rounds");
  url.searchParams.set("contentId", contentId.toString());
  url.searchParams.set("roundId", roundId.toString());
  url.searchParams.set("limit", "1");
  const response = await fetchPonderJsonOptional<PonderRoundListResponse>(url);
  if (response === null) {
    return null;
  }
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

async function fetchPonderCorrelationEligibleVoteIndexing(
  ponderBaseUrl: string,
  candidate: CorrelationRoundCandidate,
  ponderNowSeconds?: bigint,
): Promise<{ complete: boolean; eligibleCount: number } | null> {
  let eligibleCount = 0;
  for (let page = 0; page < MAX_VOTE_PAGES; page += 1) {
    const offset = page * VOTE_PAGE_SIZE;
    const url = buildCorrelationVotesUrl(
      ponderBaseUrl,
      candidate,
      VOTE_PAGE_SIZE,
      offset,
      ponderNowSeconds,
    );
    const response = await fetchPonderJsonOptional<PonderCorrelationRoundVotesResponse>(url);
    if (response === null) {
      return null;
    }
    if (response.truncated) {
      return null;
    }
    const items = response.items ?? [];
    eligibleCount += items.length;
    if (items.length < VOTE_PAGE_SIZE) {
      return { complete: true, eligibleCount };
    }
  }
  return { complete: false, eligibleCount };
}

export async function areCorrelationCandidatesPonderFresh(
  publicClient: Pick<PublicClient, "readContract">,
  candidates: readonly CorrelationRoundCandidate[],
  logger: Logger,
  options: { ponderNowSeconds?: bigint } = {},
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
      const eligibleIndexing = await fetchPonderCorrelationEligibleVoteIndexing(
        config.ponderBaseUrl,
        candidate,
        options.ponderNowSeconds,
      );
      if (eligibleIndexing === null || !eligibleIndexing.complete) {
        logger.debug(
          "Deferring correlation artifact build until Ponder indexes correlation-eligible revealed votes",
          {
            contentId: candidate.contentId.toString(),
            roundId: candidate.roundId.toString(),
            domain: candidate.domain,
            eligibleVoteCount: eligibleIndexing?.eligibleCount.toString() ?? "null",
            indexingComplete: eligibleIndexing?.complete ?? false,
          },
        );
        return false;
      }
    }
  }

  return true;
}
