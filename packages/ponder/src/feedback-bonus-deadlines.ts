import { and, eq } from "ponder";
import { feedbackBonusPool } from "ponder:schema";

export const MIN_FEEDBACK_AWARD_DECISION_SECONDS = 24n * 60n * 60n;

function toBigIntValue(value: bigint | string | number | null | undefined) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) return BigInt(value);
  return 0n;
}

// Mirrors FeedbackBonusEscrow._feedbackBonusAwardDeadline for terminal rounds:
// the awarder always gets at least 24h after settlement to decide, so the
// effective deadline is max(feedbackClosesAt, settledAt + 24h).
export function resolveFeedbackBonusAwardDeadline(
  feedbackClosesAt: bigint | string | number | null | undefined,
  settledAt: bigint | string | number | null | undefined,
) {
  const requestedDeadline = toBigIntValue(feedbackClosesAt);
  const settled = toBigIntValue(settledAt);
  if (settled === 0n) return requestedDeadline;
  const minimumAwardDeadline = settled + MIN_FEEDBACK_AWARD_DECISION_SECONDS;
  return requestedDeadline > minimumAwardDeadline
    ? requestedDeadline
    : minimumAwardDeadline;
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
  for (const pool of pools) {
    const awardDeadline = resolveFeedbackBonusAwardDeadline(
      pool.feedbackClosesAt,
      params.settledAt,
    );

    if (toBigIntValue(pool.awardDeadline) === awardDeadline) continue;

    await context.db.update(feedbackBonusPool, { id: pool.id }).set({
      awardDeadline,
      updatedAt: params.settledAt,
    });
  }
}
