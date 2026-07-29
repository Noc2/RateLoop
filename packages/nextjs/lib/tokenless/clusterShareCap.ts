const BASIS_POINTS = 10_000;

/**
 * Converts a cluster share cap into the maximum whole members a panel can contain.
 *
 * A fractional cap below one member means one member per cluster: the strictest
 * achievable diversification for a non-empty panel.
 */
export function effectiveClusterMemberCap(panelSize: number, maximumClusterShareBps: number) {
  return Math.max(1, Math.floor((panelSize * maximumClusterShareBps) / BASIS_POINTS));
}
