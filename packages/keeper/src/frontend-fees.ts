import type { Account, Chain, PublicClient, WalletClient } from "viem";
import { ContentRegistryAbi, FrontendRegistryAbi, RoundRewardDistributorAbi } from "@rateloop/contracts/abis";
import { config } from "./config.js";
import { readCurrentRoundIds, readRound, RoundState } from "./contract-reads.js";
import { writeContractAndConfirm } from "./keeper.js";
import type { Logger } from "./logger.js";
import { getRevertReason } from "./revert-utils.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const PROTOCOL_FRONTEND_FEE_DISPOSITION = 2;

interface FrontendFeeSweepCursor {
  contentId: bigint;
  roundId: bigint;
}

interface FrontendFeeSweepResult {
  frontendAddress: `0x${string}`;
  roundsClaimed: number;
  withdrawals: number;
  withdrawnAmount: bigint;
}

const recentCursors = new Map<string, FrontendFeeSweepCursor>();
const backfillCursors = new Map<string, FrontendFeeSweepCursor>();

export function resetFrontendFeeSweepStateForTests(): void {
  recentCursors.clear();
  backfillCursors.clear();
}

function sweepCursorKey(params: {
  frontendAddress: `0x${string}`;
  distributorAddress: `0x${string}`;
  scope: "recent" | "backfill";
}): string {
  return `${params.scope}:${params.distributorAddress.toLowerCase()}:${params.frontendAddress.toLowerCase()}`;
}

function nextSweepContentId(contentId: bigint, nextContentId: bigint): bigint {
  const next = contentId + 1n;
  return next < nextContentId ? next : 1n;
}

async function readLatestRoundId(params: {
  publicClient: PublicClient;
  contentId: bigint;
  cache: Map<bigint, bigint | null>;
}): Promise<bigint | null> {
  if (params.cache.has(params.contentId)) {
    return params.cache.get(params.contentId) ?? null;
  }

  try {
    const { latestRoundId } = await readCurrentRoundIds(
      params.publicClient,
      config.contracts.votingEngine,
      params.contentId,
    );
    params.cache.set(params.contentId, latestRoundId);
    return latestRoundId;
  } catch {
    params.cache.set(params.contentId, null);
    return null;
  }
}

async function previewAndClaimFrontendFee(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  chain: Chain;
  account: Account;
  logger: Logger;
  contracts: NonNullable<typeof config.frontendFees.contracts>;
  frontendAddress: `0x${string}`;
  contentId: bigint;
  roundId: bigint;
}): Promise<boolean> {
  try {
    const round = await readRound(
      params.publicClient,
      config.contracts.votingEngine,
      params.contentId,
      params.roundId,
    );
    if (round.state !== RoundState.Settled) {
      return false;
    }

    const [fee, disposition, operator, alreadyClaimed] = (await params.publicClient.readContract({
      address: params.contracts.roundRewardDistributor,
      abi: RoundRewardDistributorAbi,
      functionName: "previewFrontendFee",
      args: [params.contentId, params.roundId, params.frontendAddress],
    })) as readonly [bigint, number, `0x${string}`, boolean];

    if (fee === 0n || alreadyClaimed || disposition === PROTOCOL_FRONTEND_FEE_DISPOSITION) {
      return false;
    }

    if (operator !== ZERO_ADDRESS && operator.toLowerCase() !== params.account.address.toLowerCase()) {
      params.logger.warn("Skipping frontend fee claim because preview operator does not match keeper wallet", {
        contentId: Number(params.contentId),
        roundId: Number(params.roundId),
        frontendAddress: params.frontendAddress,
        operator,
        account: params.account.address,
      });
      return false;
    }

    await writeContractAndConfirm(params.publicClient, params.walletClient, {
      chain: params.chain,
      account: params.account,
      address: params.contracts.roundRewardDistributor,
      abi: RoundRewardDistributorAbi,
      functionName: "claimFrontendFee",
      args: [params.contentId, params.roundId, params.frontendAddress],
    });
    return true;
  } catch (error: unknown) {
    params.logger.debug("Frontend fee preview/claim skipped", {
      contentId: Number(params.contentId),
      roundId: Number(params.roundId),
      error: getRevertReason(error),
    });
    return false;
  }
}

async function scanFrontendFeeWindow(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  chain: Chain;
  account: Account;
  logger: Logger;
  contracts: NonNullable<typeof config.frontendFees.contracts>;
  frontendAddress: `0x${string}`;
  nextContentId: bigint;
  lookbackRounds: bigint;
  maxRounds: number;
  scope: "recent" | "backfill";
  cursors: Map<string, FrontendFeeSweepCursor>;
  latestRoundIdsByContent: Map<bigint, bigint | null>;
}): Promise<number> {
  if (params.maxRounds <= 0 || params.nextContentId <= 1n) {
    return 0;
  }

  const cursorKey = sweepCursorKey({
    frontendAddress: params.frontendAddress,
    distributorAddress: params.contracts.roundRewardDistributor,
    scope: params.scope,
  });
  const contentCount = params.nextContentId - 1n;
  let cursor = params.cursors.get(cursorKey) ?? { contentId: 1n, roundId: 1n };
  let scannedSlots = 0;
  let contentWithoutSweepWork = 0n;
  let roundsClaimed = 0;

  while (scannedSlots < params.maxRounds && contentWithoutSweepWork < contentCount) {
    if (cursor.contentId < 1n || cursor.contentId >= params.nextContentId) {
      cursor = { contentId: 1n, roundId: 1n };
    }

    const latestRoundId = await readLatestRoundId({
      publicClient: params.publicClient,
      contentId: cursor.contentId,
      cache: params.latestRoundIdsByContent,
    });

    if (!latestRoundId || latestRoundId === 0n) {
      scannedSlots++;
      cursor = {
        contentId: nextSweepContentId(cursor.contentId, params.nextContentId),
        roundId: 1n,
      };
      contentWithoutSweepWork++;
      continue;
    }

    const recentStartRoundId =
      latestRoundId > params.lookbackRounds ? latestRoundId - params.lookbackRounds + 1n : 1n;
    const windowStart = params.scope === "recent" ? recentStartRoundId : 1n;
    const windowEnd = params.scope === "recent" ? latestRoundId : recentStartRoundId - 1n;

    if (windowEnd < windowStart) {
      scannedSlots++;
      cursor = {
        contentId: nextSweepContentId(cursor.contentId, params.nextContentId),
        roundId: 1n,
      };
      contentWithoutSweepWork++;
      continue;
    }

    const roundId = cursor.roundId >= windowStart && cursor.roundId <= windowEnd ? cursor.roundId : windowStart;
    scannedSlots++;
    contentWithoutSweepWork = 0n;

    if (
      await previewAndClaimFrontendFee({
        publicClient: params.publicClient,
        walletClient: params.walletClient,
        chain: params.chain,
        account: params.account,
        logger: params.logger,
        contracts: params.contracts,
        frontendAddress: params.frontendAddress,
        contentId: cursor.contentId,
        roundId,
      })
    ) {
      roundsClaimed++;
    }

    const nextRoundId = roundId + 1n;
    if (nextRoundId <= windowEnd) {
      cursor = {
        contentId: cursor.contentId,
        roundId: nextRoundId,
      };
    } else {
      cursor = {
        contentId: nextSweepContentId(cursor.contentId, params.nextContentId),
        roundId: 1n,
      };
      contentWithoutSweepWork++;
    }
  }

  params.cursors.set(cursorKey, cursor);
  return roundsClaimed;
}

export async function claimConfiguredFrontendFees(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
): Promise<FrontendFeeSweepResult> {
  const frontendAddress = (config.frontendFees.frontendAddress ?? account.address) as `0x${string}`;
  const contracts = config.frontendFees.contracts;

  if (!config.frontendFees.enabled || !contracts) {
    return {
      frontendAddress,
      roundsClaimed: 0,
      withdrawals: 0,
      withdrawnAmount: 0n,
    };
  }

  if (frontendAddress.toLowerCase() !== account.address.toLowerCase()) {
    logger.warn("Skipping frontend fee sweep because keeper wallet is not the configured frontend operator", {
      frontendAddress,
      account: account.address,
    });
    return {
      frontendAddress,
      roundsClaimed: 0,
      withdrawals: 0,
      withdrawnAmount: 0n,
    };
  }

  let nextContentId: bigint;
  try {
    nextContentId = (await publicClient.readContract({
      address: config.contracts.contentRegistry,
      abi: ContentRegistryAbi,
      functionName: "nextContentId",
      args: [],
    })) as bigint;
  } catch (error: unknown) {
    logger.warn("Failed to load content count for frontend fee sweep", {
      error: getRevertReason(error),
    });
    return {
      frontendAddress,
      roundsClaimed: 0,
      withdrawals: 0,
      withdrawnAmount: 0n,
    };
  }

  let roundsClaimed = 0;
  const lookbackRounds = BigInt(Math.max(1, config.frontendFees.lookbackRounds));
  const latestRoundIdsByContent = new Map<bigint, bigint | null>();
  roundsClaimed += await scanFrontendFeeWindow({
    publicClient,
    walletClient,
    chain,
    account,
    logger,
    contracts,
    frontendAddress,
    nextContentId,
    lookbackRounds,
    maxRounds: config.frontendFees.recentRoundsPerTick,
    scope: "recent",
    cursors: recentCursors,
    latestRoundIdsByContent,
  });

  const backfillBudget = config.frontendFees.backfillRoundsPerTick;
  roundsClaimed += await scanFrontendFeeWindow({
    publicClient,
    walletClient,
    chain,
    account,
    logger,
    contracts,
    frontendAddress,
    nextContentId,
    lookbackRounds,
    maxRounds: backfillBudget,
    scope: "backfill",
    cursors: backfillCursors,
    latestRoundIdsByContent,
  });

  let withdrawals = 0;
  let withdrawnAmount = 0n;

  if (config.frontendFees.withdrawEnabled) {
    try {
      const accruedFees = (await publicClient.readContract({
        address: contracts.frontendRegistry,
        abi: FrontendRegistryAbi,
        functionName: "getAccumulatedFees",
        args: [frontendAddress],
      })) as bigint;

      if (accruedFees > 0n) {
        await writeContractAndConfirm(publicClient, walletClient, {
          chain,
          account,
          address: contracts.frontendRegistry,
          abi: FrontendRegistryAbi,
          functionName: "claimFees",
          args: [],
        });
        withdrawals = 1;
        withdrawnAmount = accruedFees;
      }
    } catch (error: unknown) {
      logger.warn("Failed to withdraw accumulated frontend fees", {
        frontendAddress,
        error: getRevertReason(error),
      });
    }
  }

  return {
    frontendAddress,
    roundsClaimed,
    withdrawals,
    withdrawnAmount,
  };
}
