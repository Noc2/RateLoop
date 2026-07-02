import type { PublicClient } from "viem";
import {
  CORRELATION_VOTE_PAGE_SIZE,
  MAX_CORRELATION_VOTE_PAGES,
  PAYOUT_DOMAIN_PUBLIC_RATING,
  PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
  PAYOUT_DOMAIN_RBTS_SETTLEMENT,
  PONDER_HTTP_FETCH_TIMEOUT_MS,
  correlationVotesPathForDomain,
} from "@rateloop/node-utils/correlationScoring";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { config } from "./config.js";
import { buildPonderRequestHeaders } from "./ponder-headers.js";
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

class PonderHttpError extends Error {
  readonly body: string;
  readonly path: string;
  readonly reason: string | null;
  readonly status: number;

  constructor(url: URL, status: number, body: string) {
    const reason = parsePonderErrorReason(body);
    super(
      `Ponder request failed: ${url.pathname} ${status}${
        reason ? ` (${reason})` : ""
      }`,
    );
    this.name = "PonderHttpError";
    this.body = body;
    this.path = url.pathname;
    this.reason = reason;
    this.status = status;
  }
}

function parsePonderErrorReason(body: string) {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record.reason === "string" && record.reason.trim()) {
        return record.reason;
      }
      if (typeof record.error === "string" && record.error.trim()) {
        return record.error;
      }
    }
  } catch {
    // Non-JSON error bodies still get logged as bounded text.
  }
  return null;
}

function buildCorrelationVotesUrl(
  ponderBaseUrl: string,
  candidate: CorrelationRoundCandidate,
  limit: number,
  offset: number,
  ponderNowSeconds?: bigint,
): URL {
  const url = buildPonderUrl(ponderBaseUrl, correlationVotesPathForDomain(candidate.domain));
  if (
    candidate.domain !== PAYOUT_DOMAIN_PUBLIC_RATING &&
    candidate.domain !== PAYOUT_DOMAIN_RBTS_SETTLEMENT
  ) {
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

async function fetchPonderJson<T>(url: URL, headers: Record<string, string> = buildPonderRequestHeaders()): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(PONDER_FETCH_TIMEOUT_MS),
  });
  const body = await readBoundedResponseText(response, PONDER_JSON_MAX_BYTES, "Ponder");
  if (!response.ok) {
    throw new PonderHttpError(url, response.status, body);
  }
  return JSON.parse(body) as T;
}

async function fetchPonderJsonOptional<T>(url: URL): Promise<T | null> {
  try {
    return await fetchPonderJson<T>(url);
  } catch {
    return null;
  }
}

async function fetchPonderJsonResult<T>(
  url: URL,
): Promise<{ ok: true; value: T } | { error: unknown; ok: false }> {
  try {
    return { ok: true, value: await fetchPonderJson<T>(url) };
  } catch (error) {
    return { error, ok: false };
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
): Promise<{ complete: boolean; eligibleCount: number; error?: unknown } | null> {
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
    const result = await fetchPonderJsonResult<PonderCorrelationRoundVotesResponse>(url);
    if (!result.ok) {
      return { complete: false, eligibleCount, error: result.error };
    }
    const response = result.value;
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
  const checkedRounds = new Map<string, { requiresEligibleVoteIndexing: boolean }>();
  const checkedEligibleVotes = new Set<string>();
  for (const candidate of candidates) {
    const roundKey = `${candidate.contentId}:${candidate.roundId}`;
    let roundFreshness = checkedRounds.get(roundKey);

    if (!roundFreshness) {
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
      const expectedRoundState =
        candidate.domain === PAYOUT_DOMAIN_RBTS_SETTLEMENT
          ? ROUND_STATE.SettlementPending
          : ROUND_STATE.Settled;
      if (chainRound.state === expectedRoundState && ponderRound.state !== expectedRoundState) {
        logger.debug("Deferring correlation artifact build until Ponder marks round source-ready", {
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

      roundFreshness = {
        requiresEligibleVoteIndexing: chainRound.state === expectedRoundState && chainRound.revealedCount > 0n,
      };
      checkedRounds.set(roundKey, roundFreshness);
    }

    if (roundFreshness.requiresEligibleVoteIndexing) {
      const eligibleVoteKey = [
        candidate.domain,
        candidate.rewardPoolId.toString(),
        candidate.contentId.toString(),
        candidate.roundId.toString(),
      ].join(":");
      if (checkedEligibleVotes.has(eligibleVoteKey)) continue;
      checkedEligibleVotes.add(eligibleVoteKey);

      const eligibleIndexing = await fetchPonderCorrelationEligibleVoteIndexing(
        config.ponderBaseUrl,
        candidate,
        options.ponderNowSeconds,
      );
      if (eligibleIndexing === null || !eligibleIndexing.complete) {
        if (eligibleIndexing?.error instanceof PonderHttpError) {
          logger.warn(
            "Deferring correlation artifact build because Ponder rejected correlation-eligible vote reconstruction",
            {
              contentId: candidate.contentId.toString(),
              roundId: candidate.roundId.toString(),
              domain: candidate.domain,
              eligibleVoteCount: eligibleIndexing.eligibleCount.toString(),
              path: eligibleIndexing.error.path,
              ponderErrorBody: eligibleIndexing.error.body,
              ponderReason: eligibleIndexing.error.reason,
              ponderStatus: eligibleIndexing.error.status,
            },
          );
          return false;
        }
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
