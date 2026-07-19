import { isAddress, isAddressEqual, type Address } from "viem";

const ACTIONS = new Set([
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
  cursor: number | null;
};
export type KeeperWorkResponse = {
  deploymentKey: string;
  chainId: number;
  panelAddress: string;
  now: string;
  work: KeeperWorkItem[];
};

export type KeeperWorkFeed = (input: {
  now: bigint;
  limit: number;
}) => Promise<unknown>;

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

export function prioritizedKeeperWorkRoundIds(
  value: unknown,
  expected: {
    deploymentKey: string;
    chainId: number;
    panelAddress: Address;
    now: bigint;
  },
) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ponder keeper work is invalid.");
  const response = value as Partial<KeeperWorkResponse>;
  if (
    response.deploymentKey !== expected.deploymentKey ||
    response.chainId !== expected.chainId ||
    !isAddress(response.panelAddress ?? "") ||
    !isAddressEqual(response.panelAddress as Address, expected.panelAddress) ||
    response.now !== expected.now.toString() ||
    !Array.isArray(response.work)
  ) {
    throw new Error("Ponder keeper work identity does not match this keeper.");
  }
  const items = response.work.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !ACTIONS.has(item.action) ||
      !/^[1-9]\d*$/u.test(item.roundId) ||
      (item.cursor !== null &&
        (!Number.isSafeInteger(item.cursor) || Number(item.cursor) < 0))
    ) {
      throw new Error("Ponder keeper work contains an invalid item.");
    }
    return { action: item.action, roundId: BigInt(item.roundId) };
  });
  items.sort(
    (left, right) =>
      Number(right.action === "finalize_scoring_seed") -
      Number(left.action === "finalize_scoring_seed"),
  );
  return items.map((item) => item.roundId);
}
