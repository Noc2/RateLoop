import { loadTokenlessChainConfig } from "./chain/config";
import "server-only";
import { type Address, encodeAbiParameters, getAddress, isAddress, isHash, keccak256, parseAbiParameters } from "viem";
import { dbClient } from "~~/lib/db";
import { type RaterSettlementSnapshot, tokenlessCommitKey } from "~~/lib/tokenless/rater/settlementRecovery";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type ChainIdentity = {
  chainId: number;
  panelAddress: Address;
  deploymentKey: string;
};
export type RaterSettlementNotificationKind = "claim_expiring" | "reveal_required";
export type RaterSettlementNotificationCandidate = {
  kind: RaterSettlementNotificationKind;
  principalAddress: string;
  sourceKey: string;
};
const COMMIT_KEY_PARAMETERS = parseAbiParameters("uint256 roundId,address voteKey");
const UNSIGNED = /^(?:0|[1-9][0-9]*)$/u;
const CLAIM_EXPIRY_NOTICE_SECONDS = 24n * 60n * 60n;

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

function indexedCommitCanReveal(input: { commit: Row; round: Row; nowSeconds: bigint }) {
  const revealDeadline = BigInt(unsigned(input.round.revealDeadline, "Indexed reveal deadline"));
  const beaconFailureDeadline = BigInt(unsigned(input.round.beaconFailureDeadline, "Indexed beacon failure deadline"));
  const revealCount = integer(input.round.revealCount, "Indexed reveal count");
  const minimumReveals = integer(input.round.minimumReveals, "Indexed minimum reveals");
  const lateRevealBlocked =
    input.nowSeconds > revealDeadline && input.commit.scoringEligible !== true && revealCount >= minimumReveals;
  return (
    input.commit.revealed !== true &&
    String(input.round.status ?? "") === "revealable" &&
    input.nowSeconds <= beaconFailureDeadline &&
    !lateRevealBlocked
  );
}

export function deriveRaterSettlementNotificationKinds(input: {
  commit: unknown;
  round: unknown;
  nowSeconds: bigint;
}): RaterSettlementNotificationKind[] {
  const commit = record(input.commit, "Indexed commit");
  const round = record(input.round, "Indexed round");
  const kinds: RaterSettlementNotificationKind[] = [];
  if (indexedCommitCanReveal({ commit, round, nowSeconds: input.nowSeconds })) {
    kinds.push("reveal_required");
  }
  const state = integer(round.state, "Indexed round state");
  const claimDeadline = BigInt(unsigned(round.claimDeadline, "Indexed claim deadline"));
  const claimAmount =
    state === 5
      ? BigInt(unsigned(commit.finalizedPayout, "Indexed finalized payout"))
      : state === 7 || state === 8
        ? BigInt(unsigned(round.compensationPerRecipient, "Indexed compensation"))
        : 0n;
  if (
    commit.revealed === true &&
    commit.claimed !== true &&
    claimAmount > 0n &&
    claimDeadline >= input.nowSeconds &&
    claimDeadline <= input.nowSeconds + CLAIM_EXPIRY_NOTICE_SECONDS &&
    round.staleReturned !== true
  ) {
    kinds.push("claim_expiring");
  }
  return kinds;
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
      indexedCommitCanReveal({ commit, round, nowSeconds: input.nowSeconds }),
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

export async function listRaterSettlementNotificationCandidates(
  input: {
    fetchImpl?: typeof fetch;
    limit?: number;
    now?: Date;
    ponderUrl?: string;
  } = {},
): Promise<RaterSettlementNotificationCandidate[]> {
  const rawLimit = input.limit ?? 20;
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1) {
    throw new Error("Settlement notification limit is invalid.");
  }
  const limit = Math.min(rawLimit, 100);
  const localResult = await dbClient.execute({
    sql: `SELECT c.commit_id, c.round_id, c.vote_key, c.deployment_key,
                 v.chain_id, v.panel_address, p.principal_id AS principal_address,
                 reveal_notice.notification_id AS reveal_notice_id,
                 claim_notice.notification_id AS claim_notice_id
          FROM tokenless_rater_commits c
          JOIN tokenless_paid_vouchers v ON v.voucher_id = c.voucher_id
          JOIN tokenless_rater_profiles p ON p.rater_id = v.rater_id
          JOIN tokenless_browser_identities b ON b.principal_address = p.principal_id
          LEFT JOIN tokenless_notifications reveal_notice
            ON reveal_notice.principal_address = p.principal_id
           AND reveal_notice.source_type = 'settlement.reveal_required'
           AND reveal_notice.source_key = c.commit_id
          LEFT JOIN tokenless_notifications claim_notice
            ON claim_notice.principal_address = p.principal_id
           AND claim_notice.source_type = 'settlement.claim_expiring'
           AND claim_notice.source_key = c.commit_id
          WHERE c.state = 'confirmed' AND p.principal_id IS NOT NULL
            AND (reveal_notice.notification_id IS NULL OR claim_notice.notification_id IS NULL)
          ORDER BY c.updated_at ASC, c.commit_id ASC LIMIT ?`,
    args: [limit],
  });
  const local = localResult.rows.map(value => value as Row);
  if (local.length === 0) return [];
  const localByCommitKey = new Map(
    local.map(row => {
      const roundId = unsigned(row.round_id, "Stored round ID");
      const voteKey = String(row.vote_key ?? "");
      if (!isAddress(voteKey)) {
        throw new TokenlessServiceError(
          "Stored settlement identity is malformed.",
          409,
          "settlement_identity_mismatch",
        );
      }
      return [tokenlessCommitKey(BigInt(roundId), getAddress(voteKey)).toLowerCase(), row] as const;
    }),
  );
  const settlementsUrl = endpoint(configuredPonderUrl(input.ponderUrl), "/settlements");
  settlementsUrl.searchParams.set("commitKeys", [...localByCommitKey.keys()].join(","));
  const indexed = record(
    await fetchJson(input.fetchImpl ?? fetch, settlementsUrl, "Indexed settlements"),
    "Indexed settlements",
  );
  if (
    indexed.schemaVersion !== "rateloop.indexed-settlements.v1" ||
    !Number.isSafeInteger(Number(indexed.chainId)) ||
    !isAddress(String(indexed.panelAddress ?? "")) ||
    !Array.isArray(indexed.items)
  ) {
    throw new TokenlessServiceError("Indexed settlements are malformed.", 409, "indexed_settlement_invalid");
  }
  const nowSeconds = BigInt(Math.floor((input.now ?? new Date()).getTime() / 1_000));
  const candidates: RaterSettlementNotificationCandidate[] = [];
  for (const [index, value] of indexed.items.entries()) {
    const item = record(value, `Indexed settlement ${index}`);
    const commit = record(item.commit, `Indexed settlement ${index} commit`);
    const commitKey = String(commit.commitKey ?? "").toLowerCase();
    const row = localByCommitKey.get(commitKey);
    if (!isHash(commitKey) || !row || !item.round) continue;
    const round = record(item.round, `Indexed settlement ${index} round`);
    if (
      String(indexed.deploymentKey ?? "") !== rowString(row, "deployment_key") ||
      Number(indexed.chainId) !== Number(row.chain_id) ||
      getAddress(String(indexed.panelAddress)) !== getAddress(String(row.panel_address)) ||
      unsigned(commit.roundId, "Indexed commit round ID") !== rowString(row, "round_id") ||
      unsigned(round.roundId, "Indexed round ID") !== rowString(row, "round_id")
    ) {
      throw new TokenlessServiceError(
        "Indexed settlements do not match the committed deployment.",
        409,
        "settlement_identity_mismatch",
      );
    }
    for (const kind of deriveRaterSettlementNotificationKinds({ commit, round, nowSeconds })) {
      if (
        (kind === "reveal_required" && rowString(row, "reveal_notice_id")) ||
        (kind === "claim_expiring" && rowString(row, "claim_notice_id"))
      ) {
        continue;
      }
      candidates.push({
        kind,
        principalAddress: rowString(row, "principal_address")!,
        sourceKey: rowString(row, "commit_id")!,
      });
    }
  }
  return candidates.slice(0, limit);
}

export type ReviewerEarning = {
  commitId: string;
  roundId: string;
  voteKey: Address;
  commitKey: `0x${string}`;
  question: string;
  committedAt: string;
  commitTransactionHash: string | null;
  claimTransactionHash: string | null;
  status:
    | "commit_pending"
    | "commit_failed"
    | "indexing"
    | "reveal_required"
    | "settling"
    | "claimable"
    | "paid"
    | "expired"
    | "no_payout";
  roundStatus: string | null;
  vote: "up" | "down" | null;
  verdict: "up" | "down" | "tie" | null;
  scoringEligible: boolean;
  earnedAtomic: string;
  claimedAtomic: string;
  claimDeadline: string | null;
};

function questionSummary(raw: string | null, roundId: string) {
  if (!raw) return `Paid review round ${roundId}`;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ["question", "prompt", "title", "text"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 240);
    }
  } catch {
    // Content display is optional; settlement identity remains chain-bound.
  }
  return `Paid review round ${roundId}`;
}

export async function listReviewerEarnings(input: {
  principalId: string;
  fetchImpl?: typeof fetch;
  ponderUrl?: string;
  now?: Date;
}) {
  const result = await dbClient.execute({
    sql: `SELECT c.commit_id, c.round_id, c.vote_key, c.state, c.transaction_hash,
                 c.created_at, c.deployment_key, v.chain_id, v.panel_address, content.content_json
          FROM tokenless_rater_commits c
          JOIN tokenless_paid_vouchers v ON v.voucher_id = c.voucher_id
          JOIN tokenless_rater_profiles p ON p.rater_id = v.rater_id
          LEFT JOIN tokenless_content_records content ON content.content_id = v.content_id
          WHERE p.principal_id = ?
          ORDER BY c.created_at DESC LIMIT 100`,
    args: [input.principalId],
  });
  const local = result.rows.map(value => value as Row);
  if (local.length === 0) {
    return {
      schemaVersion: "rateloop.reviewer-earnings.v1" as const,
      totals: { earnedAtomic: "0", claimedAtomic: "0", claimableAtomic: "0" },
      items: [] as ReviewerEarning[],
    };
  }
  const config = loadTokenlessChainConfig();
  const localByCommitKey = new Map(
    local.map(row => {
      const roundId = rowString(row, "round_id")!;
      const voteKey = getAddress(rowString(row, "vote_key")!);
      return [tokenlessCommitKey(BigInt(roundId), voteKey).toLowerCase(), row] as const;
    }),
  );
  const base = configuredPonderUrl(input.ponderUrl);
  const settlementsUrl = endpoint(base, "/settlements");
  settlementsUrl.searchParams.set("commitKeys", [...localByCommitKey.keys()].join(","));
  const indexed = record(
    await fetchJson(input.fetchImpl ?? fetch, settlementsUrl, "Indexed settlements"),
    "Indexed settlements",
  );
  if (
    indexed.schemaVersion !== "rateloop.indexed-settlements.v1" ||
    String(indexed.deploymentKey ?? "") !== config.deploymentKey ||
    integer(indexed.chainId, "Indexed settlements chain ID") !== config.chainId ||
    !isAddress(String(indexed.panelAddress ?? "")) ||
    getAddress(String(indexed.panelAddress)) !== config.panelAddress ||
    !Array.isArray(indexed.items)
  ) {
    throw new TokenlessServiceError(
      "Indexed settlements do not match the committed deployment.",
      409,
      "settlement_identity_mismatch",
    );
  }
  const indexedByCommitKey = new Map<string, Row>();
  for (const [index, value] of indexed.items.entries()) {
    const item = record(value, `Indexed settlement ${index}`);
    const commit = record(item.commit, `Indexed settlement ${index} commit`);
    const commitKey = String(commit.commitKey ?? "").toLowerCase();
    if (!isHash(commitKey) || !localByCommitKey.has(commitKey) || indexedByCommitKey.has(commitKey)) {
      throw new TokenlessServiceError("Indexed settlements are malformed.", 409, "indexed_settlement_invalid");
    }
    indexedByCommitKey.set(commitKey, item);
  }
  const nowSeconds = BigInt(Math.floor((input.now ?? new Date()).getTime() / 1_000));
  let totalEarned = 0n;
  let totalClaimed = 0n;
  let totalClaimable = 0n;
  const items = [...localByCommitKey.entries()].map(([commitKey, row]): ReviewerEarning => {
    const roundId = rowString(row, "round_id")!;
    const localState = rowString(row, "state")!;
    const indexedItem = indexedByCommitKey.get(commitKey);
    const commit = indexedItem ? record(indexedItem.commit, "Indexed commit") : null;
    const round = indexedItem?.round ? record(indexedItem.round, "Indexed round") : null;
    const claim = indexedItem?.claim ? record(indexedItem.claim, "Indexed claim") : null;
    const revealed = commit?.revealed === true;
    const claimed = commit?.claimed === true;
    const state = round ? integer(round.state, "Indexed round state") : null;
    const claimDeadlineRaw = round ? unsigned(round.claimDeadline, "Indexed claim deadline") : "0";
    const claimDeadline = claimDeadlineRaw === "0" ? null : claimDeadlineRaw;
    const finalizedPayout = commit ? BigInt(unsigned(commit.finalizedPayout, "Indexed finalized payout")) : 0n;
    const compensation =
      round && (state === 7 || state === 8)
        ? BigInt(unsigned(round.compensationPerRecipient, "Indexed compensation"))
        : 0n;
    const earned = state === 5 ? finalizedPayout : compensation;
    const claimedAmount = claim ? BigInt(unsigned(claim.amount, "Indexed claimed amount")) : 0n;
    const claimWindowOpen =
      claimDeadline !== null && nowSeconds <= BigInt(claimDeadline) && round?.staleReturned !== true;
    let status: ReviewerEarning["status"];
    if (localState === "failed") status = "commit_failed";
    else if (localState !== "confirmed") status = "commit_pending";
    else if (!commit || !round) status = "indexing";
    else if (claimed) status = "paid";
    else if (localState === "confirmed" && commit && round && indexedCommitCanReveal({ commit, round, nowSeconds }))
      status = "reveal_required";
    else if (state === 6 || ((state === 5 || state === 7 || state === 8) && earned === 0n)) status = "no_payout";
    else if ((state === 5 || state === 7 || state === 8) && claimWindowOpen) status = "claimable";
    else if ((state === 5 || state === 7 || state === 8) && !claimWindowOpen) status = "expired";
    else status = "settling";
    totalEarned += earned;
    totalClaimed += claimedAmount;
    if (status === "claimable") totalClaimable += earned;
    const revealCount = round ? integer(round.revealCount, "Indexed reveal count") : 0;
    const upVotes = round ? integer(round.upVotes, "Indexed up votes") : 0;
    const verdict =
      !round || revealCount === 0
        ? null
        : upVotes * 2 > revealCount
          ? "up"
          : upVotes * 2 < revealCount
            ? "down"
            : "tie";
    return {
      commitId: rowString(row, "commit_id")!,
      roundId,
      voteKey: getAddress(rowString(row, "vote_key")!),
      commitKey: commitKey as `0x${string}`,
      question: questionSummary(rowString(row, "content_json"), roundId),
      committedAt: new Date(String(row.created_at)).toISOString(),
      commitTransactionHash: rowString(row, "transaction_hash"),
      claimTransactionHash: claim ? String(claim.transactionHash ?? "") || null : null,
      status,
      roundStatus: round ? String(round.status ?? "") : null,
      vote: !revealed ? null : integer(commit!.vote, "Indexed vote") === 1 ? "up" : "down",
      verdict,
      scoringEligible: commit?.scoringEligible === true,
      earnedAtomic: earned.toString(10),
      claimedAtomic: claimedAmount.toString(10),
      claimDeadline,
    };
  });
  return {
    schemaVersion: "rateloop.reviewer-earnings.v1" as const,
    totals: {
      earnedAtomic: totalEarned.toString(10),
      claimedAtomic: totalClaimed.toString(10),
      claimableAtomic: totalClaimable.toString(10),
    },
    items,
  };
}
