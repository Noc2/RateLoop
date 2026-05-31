import type { Account, Chain, PublicClient, WalletClient } from "viem";
import { ContentRegistryAbi, FrontendRegistryAbi, RoundRewardDistributorAbi } from "@rateloop/contracts/abis";
import { config } from "./config.js";
import { readCurrentRoundIds, readRound, RoundState } from "./contract-reads.js";
import { writeContractAndConfirm } from "./keeper.js";
import type { Logger } from "./logger.js";
import { getRevertReason } from "./revert-utils.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const PROTOCOL_FRONTEND_FEE_DISPOSITION = 2;

interface FrontendFeeBackfillCursor {
  contentId: bigint;
  roundId: bigint;
}

interface FrontendFeeSweepResult {
  frontendAddress: `0x${string}`;
  roundsClaimed: number;
  withdrawals: number;
  withdrawnAmount: bigint;
}

const backfillCursors = new Map<string, FrontendFeeBackfillCursor>();

export function resetFrontendFeeSweepStateForTests(): void {
  backfillCursors.clear();
}

function backfillCursorKey(params: {
  frontendAddress: `0x${string}`;
  distributorAddress: `0x${string}`;
}): string {
  return `${params.distributorAddress.toLowerCase()}:${params.frontendAddress.toLowerCase()}`;
}

function nextBackfillContentId(contentId: bigint, nextContentId: bigint): bigint {
  const next = contentId + 1n;
  return next < nextContentId ? next : 1n;
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
  const latestRoundIdsByContent = new Map<bigint, bigint>();

  for (let contentId = 1n; contentId < nextContentId; contentId++) {
    let latestRoundId: bigint;
    try {
      ({ latestRoundId } = await readCurrentRoundIds(publicClient, config.contracts.votingEngine, contentId));
    } catch {
      continue;
    }

    if (latestRoundId === 0n) {
      continue;
    }
    latestRoundIdsByContent.set(contentId, latestRoundId);

    const recentStartRoundId = latestRoundId > lookbackRounds ? latestRoundId - lookbackRounds + 1n : 1n;
    for (let roundId = recentStartRoundId; roundId <= latestRoundId; roundId++) {
      if (
        await previewAndClaimFrontendFee({
          publicClient,
          walletClient,
          chain,
          account,
          logger,
          contracts,
          frontendAddress,
          contentId,
          roundId,
        })
      ) {
        roundsClaimed++;
      }
    }
  }

  const backfillBudget = config.frontendFees.backfillRoundsPerTick;
  if (backfillBudget > 0 && nextContentId > 1n) {
    const cursorKey = backfillCursorKey({
      frontendAddress,
      distributorAddress: contracts.roundRewardDistributor,
    });
    let cursor = backfillCursors.get(cursorKey) ?? { contentId: 1n, roundId: 1n };
    let scannedRounds = 0;
    let contentWithoutBackfillRounds = 0n;
    const contentCount = nextContentId - 1n;

    while (scannedRounds < backfillBudget && contentWithoutBackfillRounds < contentCount) {
      if (cursor.contentId < 1n || cursor.contentId >= nextContentId) {
        cursor = { contentId: 1n, roundId: 1n };
      }

      const latestRoundId = latestRoundIdsByContent.get(cursor.contentId);
      if (!latestRoundId || latestRoundId === 0n) {
        cursor = {
          contentId: nextBackfillContentId(cursor.contentId, nextContentId),
          roundId: 1n,
        };
        contentWithoutBackfillRounds++;
        continue;
      }

      const recentStartRoundId = latestRoundId > lookbackRounds ? latestRoundId - lookbackRounds + 1n : 1n;
      if (recentStartRoundId <= 1n) {
        cursor = {
          contentId: nextBackfillContentId(cursor.contentId, nextContentId),
          roundId: 1n,
        };
        contentWithoutBackfillRounds++;
        continue;
      }

      const roundId = cursor.roundId > 0n && cursor.roundId < recentStartRoundId ? cursor.roundId : 1n;
      scannedRounds++;
      contentWithoutBackfillRounds = 0n;
      if (
        await previewAndClaimFrontendFee({
          publicClient,
          walletClient,
          chain,
          account,
          logger,
          contracts,
          frontendAddress,
          contentId: cursor.contentId,
          roundId,
        })
      ) {
        roundsClaimed++;
      }

      const nextRoundId = roundId + 1n;
      if (nextRoundId < recentStartRoundId) {
        cursor = {
          contentId: cursor.contentId,
          roundId: nextRoundId,
        };
      } else {
        cursor = {
          contentId: nextBackfillContentId(cursor.contentId, nextContentId),
          roundId: 1n,
        };
        contentWithoutBackfillRounds++;
      }
    }

    backfillCursors.set(cursorKey, cursor);
  }

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
