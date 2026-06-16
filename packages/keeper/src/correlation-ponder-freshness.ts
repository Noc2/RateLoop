import type { PublicClient } from "viem";
import { config } from "./config.js";
import { readRound } from "./contract-reads.js";
import type { CorrelationRoundCandidate } from "./correlation-artifact-builder.js";
import type { Logger } from "./logger.js";

const PONDER_FETCH_TIMEOUT_MS = 15_000;
const PONDER_JSON_MAX_BYTES = 5_000_000;

interface PonderRoundListResponse {
  items?: Array<{ roundId?: unknown; revealedCount?: unknown }>;
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

async function fetchPonderRoundRevealedCount(
  ponderBaseUrl: string,
  contentId: bigint,
  roundId: bigint,
): Promise<bigint | null> {
  const url = new URL("/rounds", ponderBaseUrl);
  url.searchParams.set("contentId", contentId.toString());
  url.searchParams.set("limit", "200");
  const response = await fetchPonderJson<PonderRoundListResponse>(url);
  const match = (response.items ?? []).find((item) => {
    const parsedRoundId = parseBigInt(item.roundId);
    return parsedRoundId === roundId;
  });
  if (!match) {
    return null;
  }
  const revealedCount = parseBigInt(match.revealedCount);
  return revealedCount !== null && revealedCount >= 0n ? revealedCount : null;
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
    const ponderRevealedCount = await fetchPonderRoundRevealedCount(
      config.ponderBaseUrl,
      candidate.contentId,
      candidate.roundId,
    );
    if (ponderRevealedCount === null) {
      logger.debug("Deferring correlation artifact build until Ponder indexes round", {
        contentId: candidate.contentId.toString(),
        roundId: candidate.roundId.toString(),
      });
      return false;
    }
    if (ponderRevealedCount < chainRound.revealedCount) {
      logger.debug(
        "Deferring correlation artifact build until Ponder reflects revealed vote count",
        {
          contentId: candidate.contentId.toString(),
          roundId: candidate.roundId.toString(),
          chainRevealedCount: chainRound.revealedCount.toString(),
          ponderRevealedCount: ponderRevealedCount.toString(),
        },
      );
      return false;
    }
  }

  return true;
}
