import "server-only";

export class MaintenanceCancellationError extends Error {
  readonly code = "maintenance_deadline_exhausted";

  constructor() {
    super("Scheduled maintenance processing deadline was exhausted.");
    this.name = "MaintenanceCancellationError";
  }
}

export function maintenanceCancellationRequested(signal: AbortSignal | undefined) {
  return signal?.aborted === true;
}

export function throwIfMaintenanceCancelled(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new MaintenanceCancellationError();
}

export function maintenanceRequestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
