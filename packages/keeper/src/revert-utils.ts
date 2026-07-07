import {
  BaseError,
  ContractFunctionRevertedError,
  decodeAbiParameters,
  decodeErrorResult,
} from "viem";
import {
  QuestionRewardPoolEscrowAbi,
  RoundVotingEngineAbi,
} from "@rateloop/contracts/abis";

const SOLIDITY_ERROR_SELECTOR = "0x08c379a0";
const SOLIDITY_PANIC_SELECTOR = "0x4e487b71";
const REVERT_ERROR_ABIS = [
  RoundVotingEngineAbi,
  QuestionRewardPoolEscrowAbi,
] as const;

function decodeRawRevertData(data: unknown): string | null {
  if (typeof data !== "string" || !data.startsWith("0x")) return null;

  if (data.startsWith(SOLIDITY_ERROR_SELECTOR)) {
    try {
      const [reason] = decodeAbiParameters(
        [{ type: "string" }],
        `0x${data.slice(SOLIDITY_ERROR_SELECTOR.length)}`,
      );
      return typeof reason === "string" ? reason : null;
    } catch {
      return null;
    }
  }

  if (data.startsWith(SOLIDITY_PANIC_SELECTOR)) {
    try {
      const [code] = decodeAbiParameters(
        [{ type: "uint256" }],
        `0x${data.slice(SOLIDITY_PANIC_SELECTOR.length)}`,
      );
      return `Panic(${code.toString()})`;
    } catch {
      return "Panic";
    }
  }

  for (const abi of REVERT_ERROR_ABIS) {
    try {
      const decoded = decodeErrorResult({
        abi,
        data: data as `0x${string}`,
      });
      return decoded.errorName;
    } catch {
      // Try the next ABI.
    }
  }

  return null;
}

/** Extract the human-readable revert reason from a viem error. */
export function getRevertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const revertError = err.walk(e => e instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError) {
      if (typeof revertError.reason === "string" && revertError.reason) {
        return revertError.reason;
      }
      const decoded = decodeRawRevertData(revertError.raw);
      if (decoded) return decoded;
      const errorData = revertError.data as
        | { errorName?: string; args?: readonly unknown[] }
        | undefined;
      const [reason] = errorData?.args ?? [];
      if (errorData?.errorName === "Error" && typeof reason === "string") {
        return reason;
      }
      return errorData?.errorName ?? revertError.shortMessage;
    }
    const cause = err.walk() as any;
    if (cause?.data && typeof cause.data === "string" && cause.data.startsWith("0x")) {
      const decoded = decodeRawRevertData(cause.data);
      if (decoded) return decoded;
    }
    return err.shortMessage;
  }
  return (err as any)?.shortMessage || (err as any)?.message || String(err);
}

/** Returns true if the error message indicates an expected/benign revert. */
export function isExpectedRevert(msg: string): boolean {
  const benign = [
    "RoundNotOpen",
    "EpochNotEnded",
    "NotEnoughVotes",
    "UnrevealedPastEpochVotes",
    "AlreadyRevealed",
    "AlreadyCancelled",
    "ThresholdReached",
    "RevealGraceActive",
    "NothingProcessed",
    "IndexOutOfBounds",
    "ActiveRoundStillOpen",
  ];
  const lower = msg.toLowerCase();
  return benign.some(phrase => lower.includes(phrase.toLowerCase()));
}
