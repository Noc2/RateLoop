import { parseProfileSelfReport } from "@rateloop/node-utils/profileSelfReport";
import { ponder } from "ponder:registry";
import { globalStats, profile, profileSelfReportHistory } from "ponder:schema";

// Note: context.db in event handlers only supports find/insert/update/delete.
// Drizzle query builder (select/from/where) is only available in API routes.
// Aggregate counts start at 0 and are incremented by other event handlers
// (ContentSubmitted, VoteCommitted, VoteRevealed, RewardClaimed) as new events arrive.

function parseSelfReportedRaterType(selfReport: string) {
  return parseProfileSelfReport(selfReport)?.raterType ?? 0;
}

async function insertSelfReportHistory(params: {
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"];
  createdAt: bigint;
  event: Parameters<Parameters<typeof ponder.on>[1]>[0]["event"];
  name: string;
  selfReport: string;
  user: `0x${string}`;
}) {
  const blockNumber = params.event.block.number;
  const logIndex = params.event.log?.logIndex ?? 0;
  await params.context.db
    .insert(profileSelfReportHistory)
    .values({
      id: `${params.user}-${blockNumber.toString()}-${logIndex}`,
      address: params.user,
      name: params.name,
      selfReport: params.selfReport,
      selfReportedRaterType: parseSelfReportedRaterType(params.selfReport),
      createdAt: params.createdAt,
      updatedAt: params.event.block.timestamp,
      blockNumber,
      logIndex,
      transactionHash: params.event.transaction?.hash ?? null,
    })
    .onConflictDoNothing();
}

ponder.on("ProfileRegistry:ProfileCreated", async ({ event, context }) => {
  const { user, name, selfReport } = event.args;

  await context.db
    .insert(profile)
    .values({
      address: user,
      name,
      selfReport,
      selfReportedRaterType: parseSelfReportedRaterType(selfReport),
      createdAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
      totalVotes: 0,
      totalContent: 0,
      totalRewardsClaimed: 0n,
      })
    .onConflictDoNothing();

  await insertSelfReportHistory({
    context,
    createdAt: event.block.timestamp,
    event,
    name,
    selfReport,
    user,
  });

  await context.db
    .insert(globalStats)
    .values({
      id: "global",
      totalContent: 0,
      totalVotes: 0,
      totalRoundsSettled: 0,
      totalRewardsClaimed: 0n,
      totalFrontendFeesClaimed: 0n,
      totalProfiles: 1,
      totalVoterIds: 0,
    })
    .onConflictDoUpdate((row) => ({
      totalProfiles: row.totalProfiles + 1,
    }));
});

ponder.on("ProfileRegistry:ProfileUpdated", async ({ event, context }) => {
  const { user, name, selfReport } = event.args;

  const existing = await context.db.find(profile, { address: user });
  if (existing) {
    await context.db.update(profile, { address: user }).set({
      name,
      selfReport,
      selfReportedRaterType: parseSelfReportedRaterType(selfReport),
      updatedAt: event.block.timestamp,
    });
  } else {
    await context.db
      .insert(profile)
      .values({
        address: user,
        name,
        selfReport,
        selfReportedRaterType: parseSelfReportedRaterType(selfReport),
        createdAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
        totalVotes: 0,
        totalContent: 0,
        totalRewardsClaimed: 0n,
      })
      .onConflictDoNothing();
  }

  await insertSelfReportHistory({
    context,
    createdAt: existing?.createdAt ?? event.block.timestamp,
    event,
    name,
    selfReport,
    user,
  });
});
