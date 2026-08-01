export const DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_EVERY_FAILURES = 8;
export const DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_MS = 15 * 60_000;

export type DsaNamedPanelMaterializationStoredState = "retrying" | "cooldown" | "resolved";
export type DsaNamedPanelMaterializationState = "ready" | "retrying" | "cooldown";

export function dsaNamedPanelMaterializationFailureState(
  failureCount: number,
): Exclude<DsaNamedPanelMaterializationStoredState, "resolved"> {
  if (!Number.isSafeInteger(failureCount) || failureCount <= 0) {
    throw new Error("DSA named-panel materialization failure count is invalid.");
  }
  return failureCount % DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_EVERY_FAILURES === 0 ? "cooldown" : "retrying";
}

export function projectDsaNamedPanelMaterializationRetry(input: {
  storedState: unknown;
  failureCount: unknown;
  nextRetryAt: unknown;
  responseComplete: boolean;
}): {
  state: DsaNamedPanelMaterializationState;
  failureCount: number;
  nextRetryAt: string | null;
} {
  if (input.storedState === null || input.storedState === undefined) {
    if (input.failureCount !== null && input.failureCount !== undefined) {
      throw new Error("Stored DSA named-panel materialization retry state is incomplete.");
    }
    return { state: "ready", failureCount: 0, nextRetryAt: null };
  }
  if (!Number.isSafeInteger(Number(input.failureCount)) || Number(input.failureCount) < 0) {
    throw new Error("Stored DSA named-panel materialization failure count is invalid.");
  }
  const failureCount = Number(input.failureCount);
  if (input.responseComplete || input.storedState === "resolved") {
    return { state: "ready", failureCount, nextRetryAt: null };
  }
  if (input.storedState !== "retrying" && input.storedState !== "cooldown") {
    throw new Error("Stored DSA named-panel materialization retry state is invalid.");
  }
  const nextRetryAt = input.nextRetryAt instanceof Date ? input.nextRetryAt : new Date(String(input.nextRetryAt));
  if (!Number.isFinite(nextRetryAt.getTime())) {
    throw new Error("Stored DSA named-panel materialization retry time is invalid.");
  }
  return { state: input.storedState, failureCount, nextRetryAt: nextRetryAt.toISOString() };
}
