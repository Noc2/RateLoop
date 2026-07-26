import { loadTokenlessChainConfig } from "./chain/config";
import "server-only";
import { type Address, encodeAbiParameters, getAddress, isAddress, isHash, keccak256, parseAbiParameters } from "viem";
import { dbClient } from "~~/lib/db";
import type { RaterSettlementSnapshot } from "~~/lib/tokenless/rater/settlementRecovery";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type ChainIdentity = {
  chainId: number;
  panelAddress: Address;
  deploymentKey: string;
};
const COMMIT_KEY_PARAMETERS = parseAbiParameters("uint256 roundId,address voteKey");
const UNSIGNED = /^(?:0|[1-9][0-9]*)$/u;

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError(`${label} is malformed.`, 409, "indexed_settlement_invalid");
  }
  return value as Row;
}

function unsigned(value: unknown, label: string) {
  const text = typeof value === "bigint" ? value.toString(10) : String(value ?? "");
  if (!UNSIGNED.test(text)) {
    throw new TokenlessServiceError(`${label} is malformed.`, 409, "indexed_settlement_invalid");
  }
  return text;
}

function integer(value: unknown, label: string) {
  const text = unsigned(value, label);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new TokenlessServiceError(`${label} is malformed.`, 409, "indexed_settlement_invalid");
  }
  return parsed;
}

function configuredPonderUrl(raw = process.env.TOKENLESS_PONDER_URL ?? process.env.NEXT_PUBLIC_PONDER_URL) {
  const value = raw?.trim() || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:42069");
  if (!value) throw new TokenlessServiceError("Settlement index is unavailable.", 503, "ponder_unavailable", true);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TokenlessServiceError("Settlement index is unavailable.", 503, "ponder_unavailable", true);
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol) ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  ) {
    throw new TokenlessServiceError("Settlement index is unavailable.", 503, "ponder_unavailable", true);
  }
  return url;
}

function endpoint(base: URL, path: string) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
  url.search = "";
  return url;
}

async function fetchJson(fetchImpl: typeof fetch, url: URL, label: string) {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TokenlessServiceError(`${label} is not available yet.`, 409, "indexed_settlement_pending", true);
  }
  if (!response.ok) {
    throw new TokenlessServiceError(`${label} is not available yet.`, 409, "indexed_settlement_pending", true);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new TokenlessServiceError(`${label} is malformed.`, 409, "indexed_settlement_invalid");
  }
}

export function deriveRaterSettlementSnapshot(input: {
  chain: ChainIdentity;
  localCommit: {
    roundId: string;
    voteKey: string;
    state: string;
    deploymentKey: string;
    chainId: number;
    panelAddress: string;
  };
  deployment: unknown;
  round: unknown;
  commits: unknown;
  nowSeconds: bigint;
}): RaterSettlementSnapshot {
  const deployment = record(input.deployment, "Indexed deployment");
  const round = record(input.round, "Indexed round");
  if (!Array.isArray(input.commits)) {
    throw new TokenlessServiceError("Indexed commits are malformed.", 409, "indexed_settlement_invalid");
  }
  const voteKey = isAddress(input.localCommit.voteKey) ? getAddress(input.localCommit.voteKey) : null;
  if (
    !voteKey ||
    input.localCommit.deploymentKey !== input.chain.deploymentKey ||
    input.localCommit.chainId !== input.chain.chainId ||
    !isAddress(input.localCommit.panelAddress) ||
    getAddress(input.localCommit.panelAddress) !== getAddress(input.chain.panelAddress) ||
    integer(deployment.chainId, "Indexed chain ID") !== input.chain.chainId ||
    String(deployment.deploymentKey ?? "") !== input.chain.deploymentKey ||
    !isAddress(String(deployment.panelAddress ?? "")) ||
    getAddress(String(deployment.panelAddress)) !== getAddress(input.chain.panelAddress) ||
    unsigned(round.roundId, "Indexed round ID") !== input.localCommit.roundId
  ) {
    throw new TokenlessServiceError(
      "Settlement identity does not match the committed deployment.",
      409,
      "settlement_identity_mismatch",
    );
  }
  const expectedCommitKey = keccak256(
    encodeAbiParameters(COMMIT_KEY_PARAMETERS, [BigInt(input.localCommit.roundId), voteKey]),
  );
  const commit = input.commits
    .map((value, index) => record(value, `Indexed commit ${index}`))
    .find(value => String(value.voteKey ?? "").toLowerCase() === voteKey.toLowerCase());
  if (
    !commit ||
    !isHash(String(commit.commitKey ?? "")) ||
    String(commit.commitKey).toLowerCase() !== expectedCommitKey.toLowerCase() ||
    unsigned(commit.roundId, "Indexed commit round ID") !== input.localCommit.roundId
  ) {
    throw new TokenlessServiceError(
      "The committed review is not indexed yet.",
      409,
      "indexed_settlement_pending",
      true,
    );
  }
  const state = integer(round.state, "Indexed round state");
  const roundStatus = String(round.status ?? "");
  const revealed = commit.revealed === true;
  const claimed = commit.claimed === true;
  const scoringEligible = commit.scoringEligible === true;
  const finalizedPayoutAtomic = unsigned(commit.finalizedPayout, "Indexed finalized payout");
  const compensationAtomic = unsigned(round.compensationPerRecipient, "Indexed compensation");
  const commitDeadline = unsigned(round.commitDeadline, "Indexed commit deadline");
  const revealDeadline = unsigned(round.revealDeadline, "Indexed reveal deadline");
  const beaconFailureDeadline = unsigned(round.beaconFailureDeadline, "Indexed beacon failure deadline");
  const rawClaimDeadline = unsigned(round.claimDeadline, "Indexed claim deadline");
  const claimDeadline = rawClaimDeadline === "0" ? null : rawClaimDeadline;
  const claimKind = state === 5 ? "payout" : state === 7 || state === 8 ? "compensation" : null;
  const claimAmount = claimKind === "payout" ? BigInt(finalizedPayoutAtomic) : BigInt(compensationAtomic);
  return {
    schemaVersion: "rateloop.rater-settlement.v1",
    chainId: input.chain.chainId,
    panelAddress: getAddress(input.chain.panelAddress),
    roundId: input.localCommit.roundId,
    voteKey,
    commitKey: expectedCommitKey,
    roundStatus,
    commitState: input.localCommit.state,
    revealed,
    claimed,
    scoringEligible,
    finalizedPayoutAtomic,
    compensationAtomic,
    claimKind,
    canReveal:
      input.localCommit.state === "confirmed" &&
      !revealed &&
      roundStatus === "revealable" &&
      input.nowSeconds <= BigInt(beaconFailureDeadline),
    canClaim:
      input.localCommit.state === "confirmed" &&
      revealed &&
      !claimed &&
      claimKind !== null &&
      claimAmount > 0n &&
      claimDeadline !== null &&
      input.nowSeconds <= BigInt(claimDeadline) &&
      round.staleReturned !== true,
    commitDeadline,
    revealDeadline,
    beaconFailureDeadline,
    claimDeadline,
  };
}

export async function getRaterSettlementSnapshot(input: {
  principalId: string;
  roundId: string;
  voteKey: string;
  fetchImpl?: typeof fetch;
  ponderUrl?: string;
  now?: Date;
}) {
  if (!/^[1-9][0-9]*$/u.test(input.roundId) || !isAddress(input.voteKey)) {
    throw new TokenlessServiceError("Settlement lookup is malformed.", 400, "invalid_settlement_lookup");
  }
  const result = await dbClient.execute({
    sql: `SELECT c.round_id, c.vote_key, c.state, c.deployment_key,
                 v.chain_id, v.panel_address, p.principal_id
          FROM tokenless_rater_commits c
          JOIN tokenless_paid_vouchers v ON v.voucher_id = c.voucher_id
          JOIN tokenless_rater_profiles p ON p.rater_id = v.rater_id
          WHERE p.principal_id = ? AND c.round_id = ? AND LOWER(c.vote_key) = LOWER(?) LIMIT 1`,
    args: [input.principalId, input.roundId, input.voteKey],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row || rowString(row, "principal_id") !== input.principalId) {
    throw new TokenlessServiceError("Settlement was not found.", 404, "settlement_not_found");
  }
  const config = loadTokenlessChainConfig();
  const base = configuredPonderUrl(input.ponderUrl);
  const commitsUrl = endpoint(base, `/rounds/${encodeURIComponent(input.roundId)}/commits`);
  commitsUrl.searchParams.set("limit", "500");
  const fetchImpl = input.fetchImpl ?? fetch;
  const [deployment, round, commits] = await Promise.all([
    fetchJson(fetchImpl, endpoint(base, "/deployment"), "Indexed deployment"),
    fetchJson(fetchImpl, endpoint(base, `/rounds/${encodeURIComponent(input.roundId)}`), "Indexed round"),
    fetchJson(fetchImpl, commitsUrl, "Indexed commits"),
  ]);
  return deriveRaterSettlementSnapshot({
    chain: {
      chainId: config.chainId,
      panelAddress: config.panelAddress,
      deploymentKey: config.deploymentKey,
    },
    localCommit: {
      roundId: rowString(row, "round_id")!,
      voteKey: rowString(row, "vote_key")!,
      state: rowString(row, "state")!,
      deploymentKey: rowString(row, "deployment_key")!,
      chainId: Number(row.chain_id),
      panelAddress: rowString(row, "panel_address")!,
    },
    deployment,
    round,
    commits,
    nowSeconds: BigInt(Math.floor((input.now ?? new Date()).getTime() / 1_000)),
  });
}
