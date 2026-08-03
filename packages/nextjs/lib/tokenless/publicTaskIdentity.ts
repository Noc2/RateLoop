import { keccak256, stringToHex } from "viem";

export type PublicTaskIdentityInput = {
  operationKey: string;
  chainId: number;
  panelAddress: string;
  roundId: string;
};

type PublicTaskRetryRecord = {
  taskIdentity?: string;
  relayPayload?: Record<string, unknown>;
};

export function publicTaskIdentity(task: PublicTaskIdentityInput) {
  const canonicalIdentity = JSON.stringify([
    task.operationKey,
    task.chainId,
    task.panelAddress.toLowerCase(),
    task.roundId,
  ]);
  return `task_${keccak256(stringToHex(canonicalIdentity)).slice(2)}`;
}

export function publicTaskDomId(task: PublicTaskIdentityInput, control: string) {
  return `public-review-${encodeURIComponent(control)}-${publicTaskIdentity(task)}`;
}

export function queuedCommitMatchesPublicTask(record: PublicTaskRetryRecord, task: PublicTaskIdentityInput) {
  const identity = publicTaskIdentity(task);
  if (record.taskIdentity !== undefined) return record.taskIdentity === identity;

  // Queue records written before task identities were added still contain the signed on-chain
  // domain. Match that complete domain instead of falling back to the collision-prone round alone.
  const authorization = record.relayPayload?.authorization;
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) return false;
  const legacy = authorization as Record<string, unknown>;
  return (
    legacy.chainId === task.chainId &&
    typeof legacy.panelAddress === "string" &&
    legacy.panelAddress.toLowerCase() === task.panelAddress.toLowerCase() &&
    String(legacy.roundId ?? "") === task.roundId
  );
}
