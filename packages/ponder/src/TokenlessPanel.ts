import { ponder } from "ponder:registry";
import {
  tokenlessClaim,
  tokenlessCommit,
  tokenlessCreditBalance,
  tokenlessCreditEvent,
  tokenlessRound,
} from "ponder:schema";
import { keccak256, zeroHash } from "viem";
import {
  commitKey,
  creditOwnerKey,
  resolveTokenlessDeployment,
  roundKey,
} from "./protocol-deployment";
import { tokenlessPanelAbi } from "./tokenlessAbi";
import {
  creditBalanceAfterEvent,
  revealTalliesAfterVote,
  ROUND_STATE,
} from "./status";

const deployment = resolveTokenlessDeployment();

function panelAddress(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
) {
  const address = context.contracts.TokenlessPanel.address;
  const resolved = Array.isArray(address) ? address[0] : address;
  if (!resolved)
    throw new Error("TokenlessPanel address missing from Ponder context.");
  return resolved;
}

ponder.on("TokenlessPanel:RoundCreated", async ({ event, context }) => {
  const { roundId, admissionPolicyHash, scoringVersion } = event.args;
  const round = await context.client.readContract({
    abi: tokenlessPanelAbi,
    address: panelAddress(context),
    functionName: "getRound",
    args: [roundId],
  });

  await context.db.insert(tokenlessRound).values({
    id: roundKey(deployment.deploymentKey, roundId),
    deploymentKey: deployment.deploymentKey,
    roundId,
    funder: round.funder,
    contentId: round.contentId,
    termsHash: round.termsHash,
    beaconNetworkHash: round.beaconNetworkHash,
    beaconRound: round.beaconRound,
    feeRecipient: round.feeRecipient,
    bountyAmount: round.bountyAmount,
    feeAmount: round.feeAmount,
    attemptReserve: round.attemptReserve,
    attemptCompensation: round.attemptCompensation,
    fixedBasePay: round.fixedBasePay,
    maximumBonus: round.maximumBonus,
    compensationPerRecipient: round.compensationPerRecipient,
    funderRefund: 0n,
    totalCompensation: 0n,
    totalRbtsScoreBps: round.totalRbtsScoreBps,
    totalFinalizedLiability: round.totalFinalizedLiability,
    totalPaid: round.totalPaid,
    entropy: zeroHash,
    revealSetXor: round.revealSetXor,
    revealSetSum: round.revealSetSum,
    scoringSeed: round.scoringSeed,
    scoringVersion,
    scoringMode: round.scoringMode,
    minimumReveals: round.minimumReveals,
    maximumCommits: round.maximumCommits,
    admissionPolicyHash,
    commitCount: round.commitCount,
    revealCount: round.revealCount,
    frozenRevealCount: round.frozenRevealCount,
    aggregateCursor: round.aggregateCursor,
    scoreCursor: round.scoreCursor,
    upVotes: round.upVotes,
    state: round.state,
    commitDeadline: round.commitDeadline,
    revealDeadline: round.revealDeadline,
    beaconFailureDeadline: round.beaconFailureDeadline,
    claimGracePeriod: round.claimGracePeriod,
    claimDeadline: round.claimDeadline,
    staleReturned: round.staleReturned,
    staleAmount: 0n,
    createdAt: event.block.timestamp,
    createdBlock: event.block.number,
    createdTxHash: event.transaction.hash,
    updatedAt: event.block.timestamp,
  });
});

ponder.on("TokenlessPanel:CommitAccepted", async ({ event, context }) => {
  const {
    roundId,
    commitKey: rawCommitKey,
    nullifier,
    sealedPayload,
  } = event.args;
  const record = await context.client.readContract({
    abi: tokenlessPanelAbi,
    address: panelAddress(context),
    functionName: "getCommit",
    args: [rawCommitKey],
  });

  await context.db.insert(tokenlessCommit).values({
    id: commitKey(deployment.deploymentKey, rawCommitKey),
    deploymentKey: deployment.deploymentKey,
    commitKey: rawCommitKey,
    roundId,
    voteKey: record.voteKey,
    nullifier,
    sealedCommitment: record.sealedCommitment,
    sealedPayloadHash: keccak256(sealedPayload),
    sealedPayload,
    payoutCommitment: record.payoutCommitment,
    responseHash: record.responseHash,
    vote: record.vote,
    predictedUpBps: record.predictedUpBps,
    referenceCommitKey: record.referenceCommitKey,
    peerCommitKey: record.peerCommitKey,
    finalizedPayout: record.finalizedPayout,
    informationScoreBps: record.informationScoreBps,
    predictionScoreBps: record.predictionScoreBps,
    rbtsScoreBps: record.rbtsScoreBps,
    revealed: record.revealed,
    claimed: record.claimed,
    committedAt: event.block.timestamp,
    revealedAt: null,
    commitTxHash: event.transaction.hash,
    commitLogIndex: event.log.logIndex,
  });

  await context.db
    .update(tokenlessRound, { id: roundKey(deployment.deploymentKey, roundId) })
    .set((row) => ({
      commitCount: row.commitCount + 1,
      updatedAt: event.block.timestamp,
    }));
});

ponder.on("TokenlessPanel:RevealAccepted", async ({ event, context }) => {
  const {
    roundId,
    commitKey: rawCommitKey,
    vote,
    predictedUpBps,
    responseHash,
    scoringEligible,
  } = event.args;
  await context.db
    .update(tokenlessCommit, {
      id: commitKey(deployment.deploymentKey, rawCommitKey),
    })
    .set({
      vote,
      predictedUpBps,
      responseHash,
      revealed: true,
      scoringEligible,
      revealedAt: event.block.timestamp,
    });
  await context.db
    .update(tokenlessRound, { id: roundKey(deployment.deploymentKey, roundId) })
    .set((row) => ({
      ...revealTalliesAfterVote(row, vote, scoringEligible),
      state: ROUND_STATE.REVEALABLE,
      updatedAt: event.block.timestamp,
    }));
});

ponder.on("TokenlessPanel:SettlementBegun", async ({ event, context }) => {
  await context.db
    .update(tokenlessRound, {
      id: roundKey(deployment.deploymentKey, event.args.roundId),
    })
    .set({
      state: ROUND_STATE.AGGREGATING,
      frozenRevealCount: event.args.frozenRevealCount,
      beaconRound: event.args.beaconRound,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("TokenlessPanel:SettlementProgressed", async ({ event, context }) => {
  const id = roundKey(deployment.deploymentKey, event.args.roundId);
  const existing = await context.db.find(tokenlessRound, { id });
  if (!existing)
    throw new Error(
      `Settlement progress references unknown round ${event.args.roundId}.`,
    );

  await context.db.update(tokenlessRound, { id }).set({
    state: event.args.state,
    aggregateCursor:
      existing.state === ROUND_STATE.AGGREGATING
        ? event.args.cursor
        : existing.aggregateCursor,
    scoreCursor:
      existing.state === ROUND_STATE.SCORING
        ? event.args.cursor
        : existing.scoreCursor,
    updatedAt: event.block.timestamp,
  });
});

ponder.on("TokenlessPanel:ScoringSeedFinalized", async ({ event, context }) => {
  await context.db
    .update(tokenlessRound, {
      id: roundKey(deployment.deploymentKey, event.args.roundId),
    })
    .set({
      state: ROUND_STATE.SCORING,
      scoringMode: event.args.mode,
      beaconRound: event.args.beaconRound,
      entropy: event.args.entropy,
      scoringSeed: event.args.scoringSeed,
      revealSetXor: event.args.revealSetXor,
      revealSetSum: event.args.revealSetSum,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("TokenlessPanel:RevealScored", async ({ event, context }) => {
  const {
    commitKey: rawCommitKey,
    referenceCommitKey,
    peerCommitKey,
    informationScoreBps,
    predictionScoreBps,
    rbtsScoreBps,
    finalizedPayout,
  } = event.args;
  await context.db
    .update(tokenlessCommit, {
      id: commitKey(deployment.deploymentKey, rawCommitKey),
    })
    .set({
      referenceCommitKey,
      peerCommitKey,
      informationScoreBps,
      predictionScoreBps,
      rbtsScoreBps,
      finalizedPayout,
    });
});

ponder.on("TokenlessPanel:RoundFinalized", async ({ event, context }) => {
  const {
    roundId,
    mode,
    totalRbtsScoreBps,
    totalFinalizedLiability,
    funderRefund,
    claimDeadline,
  } = event.args;
  await context.db
    .update(tokenlessRound, { id: roundKey(deployment.deploymentKey, roundId) })
    .set({
      state: ROUND_STATE.FINALIZED,
      scoringMode: mode,
      totalRbtsScoreBps,
      totalFinalizedLiability,
      funderRefund,
      claimDeadline,
      finalizedAt: event.block.timestamp,
      finalizedBlock: event.block.number,
      finalizedBlockHash: event.block.hash,
      finalizedTxHash: event.transaction.hash,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("TokenlessPanel:RoundTerminal", async ({ event, context }) => {
  const { roundId, state, funderRefund, compensation } = event.args;
  const round = await context.client.readContract({
    abi: tokenlessPanelAbi,
    address: panelAddress(context),
    functionName: "getRound",
    args: [roundId],
  });
  await context.db
    .update(tokenlessRound, { id: roundKey(deployment.deploymentKey, roundId) })
    .set({
      state,
      funderRefund,
      totalCompensation: compensation,
      compensationPerRecipient: round.compensationPerRecipient,
      claimDeadline: round.claimDeadline,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("TokenlessPanel:Claimed", async ({ event, context }) => {
  const {
    roundId,
    commitKey: rawCommitKey,
    payoutAddress,
    amount,
  } = event.args;
  await context.db.insert(tokenlessClaim).values({
    id: `${deployment.deploymentKey}:${event.transaction.hash}:${event.log.logIndex}`,
    deploymentKey: deployment.deploymentKey,
    roundId,
    commitKey: rawCommitKey,
    payoutAddress,
    amount,
    claimedAt: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });
  await context.db
    .update(tokenlessCommit, {
      id: commitKey(deployment.deploymentKey, rawCommitKey),
    })
    .set({ claimed: true });
  await context.db
    .update(tokenlessRound, { id: roundKey(deployment.deploymentKey, roundId) })
    .set((row) => ({
      totalPaid: row.totalPaid + amount,
      updatedAt: event.block.timestamp,
    }));
});

ponder.on("TokenlessPanel:CreditAccrued", async ({ event, context }) => {
  const { roundId, recipient, amount } = event.args;
  const owner = recipient.toLowerCase() as `0x${string}`;
  const id = creditOwnerKey(deployment.deploymentKey, owner);
  const existing = await context.db.find(tokenlessCreditBalance, { id });
  const remainingCredit = creditBalanceAfterEvent(
    existing?.remainingCredit ?? 0n,
    "accrued",
    amount,
  );

  if (existing) {
    await context.db.update(tokenlessCreditBalance, { id }).set({
      remainingCredit,
      totalAccrued: existing.totalAccrued + amount,
      updatedAt: event.block.timestamp,
      updatedBlock: event.block.number,
    });
  } else {
    await context.db.insert(tokenlessCreditBalance).values({
      id,
      deploymentKey: deployment.deploymentKey,
      owner,
      remainingCredit,
      totalAccrued: amount,
      totalWithdrawn: 0n,
      updatedAt: event.block.timestamp,
      updatedBlock: event.block.number,
    });
  }

  await context.db.insert(tokenlessCreditEvent).values({
    id: `${deployment.deploymentKey}:${event.transaction.hash}:${event.log.logIndex}`,
    deploymentKey: deployment.deploymentKey,
    owner,
    eventType: "accrued",
    roundId,
    destination: null,
    amount,
    remainingCredit,
    occurredAt: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });
});

ponder.on("TokenlessPanel:CreditWithdrawn", async ({ event, context }) => {
  const { recipient, destination, amount } = event.args;
  const owner = recipient.toLowerCase() as `0x${string}`;
  const id = creditOwnerKey(deployment.deploymentKey, owner);
  const existing = await context.db.find(tokenlessCreditBalance, { id });
  if (!existing)
    throw new Error(`Credit withdrawal references unknown owner ${owner}.`);
  const remainingCredit = creditBalanceAfterEvent(
    existing.remainingCredit,
    "withdrawn",
    amount,
  );

  await context.db.update(tokenlessCreditBalance, { id }).set({
    remainingCredit,
    totalWithdrawn: existing.totalWithdrawn + amount,
    updatedAt: event.block.timestamp,
    updatedBlock: event.block.number,
  });
  await context.db.insert(tokenlessCreditEvent).values({
    id: `${deployment.deploymentKey}:${event.transaction.hash}:${event.log.logIndex}`,
    deploymentKey: deployment.deploymentKey,
    owner,
    eventType: "withdrawn",
    roundId: null,
    destination,
    amount,
    remainingCredit,
    occurredAt: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
  });
});

ponder.on("TokenlessPanel:StaleSharesReturned", async ({ event, context }) => {
  await context.db
    .update(tokenlessRound, {
      id: roundKey(deployment.deploymentKey, event.args.roundId),
    })
    .set({
      staleReturned: true,
      staleAmount: event.args.amount,
      updatedAt: event.block.timestamp,
    });
});
