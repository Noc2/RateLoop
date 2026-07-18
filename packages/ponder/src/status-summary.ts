export function tokenlessStatusSummary(input: {
  roundStates: Array<{ state: number; total: number | bigint }>;
  creditOwners: number | bigint | undefined;
  creditEvents: number | bigint | undefined;
  feedbackBonusPools: number | bigint | undefined;
  feedbackBonusEvents: number | bigint | undefined;
  totalRemainingCredit: string | number | bigint | null | undefined;
}) {
  const byState: Record<string, number> = {};
  let rounds = 0;
  for (const row of input.roundStates) {
    const total = Number(row.total);
    byState[String(row.state)] = total;
    rounds += total;
  }
  return {
    rounds,
    byState,
    creditOwners: Number(input.creditOwners ?? 0),
    creditEvents: Number(input.creditEvents ?? 0),
    feedbackBonusPools: Number(input.feedbackBonusPools ?? 0),
    feedbackBonusEvents: Number(input.feedbackBonusEvents ?? 0),
    totalRemainingCredit: String(input.totalRemainingCredit ?? 0),
  };
}
