import { type Address, type Hex, isAddress } from "viem";

export type WalletTransactionPlanCall = {
  data?: unknown;
  description?: string;
  functionName?: string;
  id?: string;
  phase?: string;
  to?: unknown;
  value?: unknown;
  waitAfterMs?: number;
};

export type NormalizedWalletTransactionPlanCall<TCall extends WalletTransactionPlanCall = WalletTransactionPlanCall> = {
  call: TCall;
  data: Hex;
  index: number;
  postCallDelayMs: number;
  to: Address;
  value: bigint;
};

export type WalletTransactionPlanExecutionSegment<TCall extends WalletTransactionPlanCall = WalletTransactionPlanCall> =
  {
    batchable: boolean;
    calls: Array<NormalizedWalletTransactionPlanCall<TCall>>;
  };

function normalizeHex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x([a-fA-F0-9]{2})*$/.test(value)) {
    throw new Error(`${field} must be hex data.`);
  }
  return value as Hex;
}

function normalizeAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${field} must be an EVM address.`);
  }
  return value as Address;
}

function assertZeroValue(value: unknown, field: string) {
  if (value === undefined || value === null || value === "" || value === "0" || value === 0 || value === 0n) return 0n;
  if (typeof value === "string" && /^0x0+$/i.test(value)) return 0n;
  throw new Error(`${field} must be zero.`);
}

export function normalizeWalletTransactionPlanCalls<TCall extends WalletTransactionPlanCall>(
  calls: readonly TCall[],
  options: {
    getPostCallDelayMs?: (call: TCall) => number;
  } = {},
) {
  return calls.map((call, index) => ({
    call,
    data: normalizeHex(call.data ?? "0x", `transactionPlan.calls[${index}].data`),
    index,
    postCallDelayMs: Math.max(0, options.getPostCallDelayMs?.(call) ?? 0),
    to: normalizeAddress(call.to, `transactionPlan.calls[${index}].to`),
    value: assertZeroValue(call.value, `transactionPlan.calls[${index}].value`),
  }));
}

export function createWalletTransactionPlanExecutionSegments<TCall extends WalletTransactionPlanCall>(
  calls: readonly NormalizedWalletTransactionPlanCall<TCall>[],
) {
  const segments: Array<WalletTransactionPlanExecutionSegment<TCall>> = [];
  let pendingBatchableCalls: Array<NormalizedWalletTransactionPlanCall<TCall>> = [];

  const flushBatchableCalls = () => {
    if (pendingBatchableCalls.length === 0) return;
    segments.push({
      batchable: pendingBatchableCalls.length > 1,
      calls: pendingBatchableCalls,
    });
    pendingBatchableCalls = [];
  };

  for (const call of calls) {
    if (call.postCallDelayMs > 0) {
      flushBatchableCalls();
      segments.push({ batchable: false, calls: [call] });
      continue;
    }

    pendingBatchableCalls.push(call);
  }

  flushBatchableCalls();
  return segments;
}

export function isWalletSendCallsUnsupportedError(error: unknown) {
  const message =
    (error as { message?: string; shortMessage?: string } | undefined)?.message ??
    (error as { message?: string; shortMessage?: string } | undefined)?.shortMessage ??
    "";
  const normalized = message.toLowerCase();

  return (
    normalized.includes("wallet_sendcalls") ||
    normalized.includes("method not found") ||
    normalized.includes("not supported") ||
    normalized.includes("unsupported") ||
    normalized.includes("not implemented")
  );
}
