import type { Hex } from "viem";
import type { WalletTransactionPlanCall } from "~~/lib/agent/walletTransactionPlan";

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function isFeedbackBonusRecoveryHash(value: unknown): value is Hex {
  return typeof value === "string" && TRANSACTION_HASH_PATTERN.test(value);
}

export function isFeedbackBonusPoolCreationCall(call: WalletTransactionPlanCall) {
  return (
    call.functionName === "createFeedbackBonusPoolWithAsset" ||
    call.phase === "create_feedback_bonus_pool" ||
    call.id === "create-feedback-bonus-pool"
  );
}

export function appendFeedbackBonusRecoveryHash(hashes: readonly string[], hash: unknown) {
  if (!isFeedbackBonusRecoveryHash(hash) || hashes.includes(hash)) return [...hashes];
  return [...hashes, hash];
}

export function appendFeedbackBonusPoolCreationRecoveryHash(params: {
  call: WalletTransactionPlanCall;
  hash: unknown;
  hashes: readonly string[];
}) {
  if (!isFeedbackBonusPoolCreationCall(params.call)) return [...params.hashes];
  return appendFeedbackBonusRecoveryHash(params.hashes, params.hash);
}

export function readFeedbackBonusRecoveryStorageValue(raw: string | null, operationKey: string | null | undefined) {
  if (!raw || !operationKey) return [];
  const parsed = JSON.parse(raw) as { hashes?: unknown; operationKey?: unknown };
  if (parsed.operationKey !== operationKey || !Array.isArray(parsed.hashes)) return [];
  return parsed.hashes.filter(isFeedbackBonusRecoveryHash);
}

export function serializeFeedbackBonusRecoveryStorageValue(params: {
  hashes: readonly string[];
  operationKey: string | null;
}) {
  const hashes = params.hashes.filter(isFeedbackBonusRecoveryHash);
  if (!params.operationKey || hashes.length === 0) return null;
  return JSON.stringify({ hashes, operationKey: params.operationKey });
}
