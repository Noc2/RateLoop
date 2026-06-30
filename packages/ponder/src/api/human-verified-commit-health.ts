import { and, eq, sql } from "ponder";
import { db } from "ponder:api";
import { round, vote } from "ponder:schema";

const HUMAN_CREDENTIAL_MASK = 1 << 3;

type HumanVerifiedCommitCountHealth = {
  status: "ok" | "warning";
  staleRoundCount: number;
  message?: string;
};

const STALE_HRC_MESSAGE =
  "Some round rows have humanVerifiedCommitCount=0 while indexed votes carry human credentials. " +
  "Run the human_verified_commit_count backfill in packages/ponder/README.md before relying on keeper dormancy filters.";

export async function inspectHumanVerifiedCommitCountHealth(): Promise<HumanVerifiedCommitCountHealth> {
  const [result] = await db
    .select({ staleRoundCount: sql<number>`count(*)::integer` })
    .from(round)
    .where(
      and(
        eq(round.humanVerifiedCommitCount, 0),
        sql`exists (
          select 1 from ${vote}
          where ${vote.contentId} = ${round.contentId}
            and ${vote.roundId} = ${round.roundId}
            and (${vote.credentialMask} & ${HUMAN_CREDENTIAL_MASK}) != 0
            and ${vote.committedAt} > 0
        )`,
      ),
    );

  const staleRoundCount = result?.staleRoundCount ?? 0;
  if (staleRoundCount > 0) {
    return { status: "warning", staleRoundCount, message: STALE_HRC_MESSAGE };
  }

  return { status: "ok", staleRoundCount: 0 };
}
