import { QuestionRewardPoolEscrowAbi } from "@rateloop/contracts/abis";
import type { Address, PublicClient } from "viem";

type EventScanClient = Pick<PublicClient, "getContractEvents">;

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function readEventAmount(args: unknown): bigint | null {
  if (!args || typeof args !== "object") return null;
  const amount = (args as Record<string, unknown>).amount;
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number" && Number.isFinite(amount)) return BigInt(amount);
  if (typeof amount === "string" && /^\d+$/.test(amount)) return BigInt(amount);
  return null;
}

type RewardPoolCreatedLog = {
  args?: {
    amount?: bigint;
    contentId?: bigint;
    funder?: Address;
  };
};

export async function hasRewardPoolFundedPostcondition(params: {
  amount: bigint;
  client: EventScanClient;
  contentId: bigint;
  escrowAddress: Address;
  funder: Address;
  startBlock: bigint;
}) {
  const events = await params.client.getContractEvents({
    address: params.escrowAddress,
    abi: QuestionRewardPoolEscrowAbi,
    eventName: "RewardPoolCreated",
    args: {
      contentId: params.contentId,
      funder: params.funder,
    },
    fromBlock: params.startBlock,
    toBlock: "latest",
  } as never);

  return (events as RewardPoolCreatedLog[]).some(event => {
    const funder = String(event.args?.funder ?? "");
    const amount = readEventAmount(event.args);
    return normalizeAddress(funder) === normalizeAddress(params.funder) && amount === params.amount;
  });
}
