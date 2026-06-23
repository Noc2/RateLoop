import { FeedbackRegistryAbi } from "@rateloop/contracts/abis";
import type { Address, Hex, PublicClient } from "viem";
import { zeroHash } from "viem";
import { FEEDBACK_BONUS_ESCROW_ABI } from "~~/lib/questionRewardPools";

type ReadContractClient = Pick<PublicClient, "readContract">;

function normalizeHex(value: string) {
  return value.toLowerCase();
}

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function readTupleOrObjectField(record: unknown, name: string, index: number): unknown {
  if (Array.isArray(record)) return record[index];
  if (record && typeof record === "object" && name in record) {
    return (record as Record<string, unknown>)[name];
  }
  return undefined;
}

function readBigIntField(record: unknown, name: string, index: number): bigint | null {
  const value = readTupleOrObjectField(record, name, index);
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function readFeedbackRecordHash(record: unknown): string | null {
  const rawHash = readTupleOrObjectField(record, "feedbackHash", 0);
  return typeof rawHash === "string" ? rawHash : null;
}

function readFeedbackBonusPoolRemainingAmount(pool: unknown) {
  return readBigIntField(pool, "remainingAmount", 12);
}

export async function hasPublishedFeedbackPostcondition(params: {
  client: ReadContractClient;
  commitKey: Hex;
  contentId: bigint;
  expectedFeedbackHash: Hex;
  feedbackRegistryAddress: Address;
  roundId: bigint;
}) {
  const record = await params.client.readContract({
    address: params.feedbackRegistryAddress,
    abi: FeedbackRegistryAbi,
    functionName: "feedbackByCommitKey",
    args: [params.contentId, params.roundId, params.commitKey],
  } as never);
  const feedbackHash = readFeedbackRecordHash(record);
  return Boolean(
    feedbackHash &&
      normalizeHex(feedbackHash) !== zeroHash &&
      normalizeHex(feedbackHash) === normalizeHex(params.expectedFeedbackHash),
  );
}

export async function hasFeedbackBonusAwardPostcondition(params: {
  client: ReadContractClient;
  escrowAddress: Address;
  expectedRemainingAmount?: bigint;
  feedbackHash: Hex;
  poolId: bigint;
}) {
  const isAwarded =
    (await params.client.readContract({
      address: params.escrowAddress,
      abi: FEEDBACK_BONUS_ESCROW_ABI,
      functionName: "feedbackHashAwarded",
      args: [params.poolId, params.feedbackHash],
    } as never)) === true;
  if (!isAwarded) return false;

  if (typeof params.expectedRemainingAmount === "undefined") {
    return true;
  }

  const pool = await params.client.readContract({
    address: params.escrowAddress,
    abi: FEEDBACK_BONUS_ESCROW_ABI,
    functionName: "feedbackBonusPools",
    args: [params.poolId],
  } as never);
  return readFeedbackBonusPoolRemainingAmount(pool) === params.expectedRemainingAmount;
}

export async function hasFeedbackBonusPoolCreatedPostcondition(params: {
  amount: bigint;
  asset: number;
  awarder: Address;
  client: ReadContractClient;
  contentId: bigint;
  escrowAddress: Address;
  feedbackClosesAt: bigint;
  funder: Address;
  maxScanCount?: number;
  roundId: bigint;
  startPoolId: bigint;
}) {
  const maxScanCount = params.maxScanCount ?? 8;
  for (let offset = 0; offset < maxScanCount; offset += 1) {
    const poolId = params.startPoolId + BigInt(offset);
    const pool = await params.client.readContract({
      address: params.escrowAddress,
      abi: FEEDBACK_BONUS_ESCROW_ABI,
      functionName: "feedbackBonusPools",
      args: [poolId],
    } as never);
    const storedId = readBigIntField(pool, "id", 0);
    if (storedId === null || storedId === 0n) continue;

    const contentId = readBigIntField(pool, "contentId", 1);
    const roundId = readBigIntField(pool, "roundId", 2);
    const feedbackClosesAt = readBigIntField(pool, "feedbackClosesAt", 3);
    const funder = String(readTupleOrObjectField(pool, "funder", 4) ?? "");
    const awarder = String(readTupleOrObjectField(pool, "awarder", 7) ?? "");
    const fundedAmount = readBigIntField(pool, "fundedAmount", 11);
    const remainingAmount = readFeedbackBonusPoolRemainingAmount(pool);
    const asset = Number(readTupleOrObjectField(pool, "asset", 15));

    if (
      contentId === params.contentId &&
      roundId === params.roundId &&
      feedbackClosesAt === params.feedbackClosesAt &&
      normalizeAddress(funder) === normalizeAddress(params.funder) &&
      normalizeAddress(awarder) === normalizeAddress(params.awarder) &&
      fundedAmount === params.amount &&
      remainingAmount === params.amount &&
      asset === params.asset
    ) {
      return true;
    }
  }

  return false;
}
