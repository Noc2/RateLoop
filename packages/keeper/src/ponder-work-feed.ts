import { isAddress, isAddressEqual, type Address } from "viem";

const ACTIONS = new Set([
  "service_commits",
  "begin_settlement",
  "process_aggregate",
  "finalize_scoring_seed",
  "process_scores",
  "finalize_settlement",
  "return_stale_shares",
]);

export type KeeperWorkItem = {
  action: string;
  roundId: string;
  createdBlock: string;
  cursor: number | null;
};
export type KeeperWorkResponse = {
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  now: string;
  direction: "desc";
  nextCursor: string | null;
  work: KeeperWorkItem[];
};

export type KeeperWorkFeed = (input: {
  now: bigint;
  limit: number;
  cursor?: bigint;
}) => Promise<unknown>;

export class PonderWorkFeedIdentityMismatchError extends Error {
  constructor() {
    super("Ponder keeper work identity does not match this keeper.");
    this.name = "PonderWorkFeedIdentityMismatchError";
  }
}

export function createPonderWorkFeed(input: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): KeeperWorkFeed {
  return async (request) => {
    const url = new URL(input.baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/keeper/work`;
    url.search = "";
    url.searchParams.set("now", request.now.toString());
    url.searchParams.set("direction", "desc");
    url.searchParams.set("limit", String(request.limit));
    if (request.cursor !== undefined) {
      url.searchParams.set("cursor", request.cursor.toString());
    }
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.token}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok)
      throw new Error(`Ponder keeper work returned HTTP ${response.status}.`);
    return response.json();
  };
}

export function prioritizedKeeperWorkPage(
  value: unknown,
  expected: {
    deploymentKey: string;
    chainId: number;
    panelAddress: Address;
    now: bigint;
    cursor?: bigint;
  },
) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ponder keeper work is invalid.");
  const response = value as Partial<KeeperWorkResponse>;
  if (
    response.deploymentKey !== expected.deploymentKey ||
    response.chainId !== expected.chainId ||
    !isAddress(response.panelAddress ?? "") ||
    !isAddressEqual(response.panelAddress as Address, expected.panelAddress)
  ) {
    throw new PonderWorkFeedIdentityMismatchError();
  }
  if (
    response.now !== expected.now.toString() ||
    response.direction !== "desc" ||
    !Array.isArray(response.work)
  ) {
    throw new Error("Ponder keeper work is invalid.");
  }
  const nextCursor =
    response.nextCursor === null
      ? null
      : typeof response.nextCursor === "string" &&
          /^[1-9]\d*$/u.test(response.nextCursor)
        ? BigInt(response.nextCursor)
        : undefined;
  if (
    nextCursor === undefined ||
    (expected.cursor !== undefined &&
      nextCursor !== null &&
      nextCursor >= expected.cursor)
  ) {
    throw new Error("Ponder keeper work is invalid.");
  }
  const items = response.work.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !ACTIONS.has(item.action) ||
      !/^[1-9]\d*$/u.test(item.roundId) ||
      !/^(?:0|[1-9]\d*)$/u.test(item.createdBlock) ||
      (item.cursor !== null &&
        (!Number.isSafeInteger(item.cursor) || Number(item.cursor) < 0))
    ) {
      throw new Error("Ponder keeper work contains an invalid item.");
    }
    return {
      action: item.action,
      roundId: BigInt(item.roundId),
      createdBlock: BigInt(item.createdBlock),
    };
  });
  items.sort(
    (left, right) =>
      Number(right.action === "finalize_scoring_seed") -
      Number(left.action === "finalize_scoring_seed"),
  );
  return {
    items,
    nextCursor,
  };
}

export function prioritizedKeeperWorkItems(
  value: unknown,
  expected: {
    deploymentKey: string;
    chainId: number;
    panelAddress: Address;
    now: bigint;
    cursor?: bigint;
  },
) {
  return prioritizedKeeperWorkPage(value, expected).items;
}

export function prioritizedKeeperWorkRoundIds(
  value: unknown,
  expected: {
    deploymentKey: string;
    chainId: number;
    panelAddress: Address;
    now: bigint;
  },
) {
  return prioritizedKeeperWorkItems(value, expected).map(
    (item) => item.roundId,
  );
}
