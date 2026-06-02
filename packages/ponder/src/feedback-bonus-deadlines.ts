import { and, eq } from "ponder";
import { feedbackBonusPool } from "ponder:schema";

export const MIN_FEEDBACK_AWARD_DECISION_SECONDS = 24n * 60n * 60n;

function toBigIntValue(value: bigint | string | number | null | undefined) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) return BigInt(value);
  return 0n;
}

export async function extendFeedbackBonusAwardDeadlinesForTerminalRound(
  context: { db: any },
  params: { contentId: bigint; roundId: bigint; settledAt: bigint },
) {
  const pools = await context.db.sql
    .select()
    .from(feedbackBonusPool)
    .where(
      and(
        eq(feedbackBonusPool.contentId, params.contentId),
        eq(feedbackBonusPool.roundId, params.roundId),
      ),
    );
  const minimumAwardDeadline =
    params.settledAt + MIN_FEEDBACK_AWARD_DECISION_SECONDS;

  for (const pool of pools) {
    const requestedDeadline = toBigIntValue(pool.feedbackClosesAt);
    const awardDeadline =
      requestedDeadline > minimumAwardDeadline
        ? requestedDeadline
        : minimumAwardDeadline;

    if (toBigIntValue(pool.awardDeadline) === awardDeadline) continue;

    await context.db.update(feedbackBonusPool, { id: pool.id }).set({
      awardDeadline,
      updatedAt: params.settledAt,
    });
  }
}
