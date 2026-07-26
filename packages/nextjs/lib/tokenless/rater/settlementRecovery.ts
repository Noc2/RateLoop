import { TokenlessPanelAbi } from "@rateloop/contracts/tokenless";
import {
  type Address,
  type Hash,
  type Hex,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHash,
  keccak256,
  parseAbiParameters,
} from "viem";
import { baseSepolia } from "viem/chains";
import { tokenlessSelfRevealArguments } from "~~/lib/tokenless/rater/signing";
import type { TokenlessRaterRoundSecrets } from "~~/lib/tokenless/rater/types";

const COMMIT_KEY_PARAMETERS = parseAbiParameters("uint256 roundId,address voteKey");

export type RaterSettlementSnapshot = {
  schemaVersion: "rateloop.rater-settlement.v1";
  chainId: number;
  panelAddress: Address;
  roundId: string;
  voteKey: Address;
  commitKey: Hex;
  roundStatus: string;
  commitState: string;
  revealed: boolean;
  claimed: boolean;
  scoringEligible: boolean;
  finalizedPayoutAtomic: string;
  compensationAtomic: string;
  claimKind: "payout" | "compensation" | null;
  canReveal: boolean;
  canClaim: boolean;
  commitDeadline: string;
  revealDeadline: string;
  beaconFailureDeadline: string;
  claimDeadline: string | null;
};

export type RaterSettlementAuthorization = {
  action: "reveal" | "claim";
  chainId: number;
  panelAddress: Address;
  roundId: bigint;
  voteKey: Address;
  commitKey: Hex;
  payoutAddress: Address;
  relayerAddress: Address;
  expectedAmountAtomic: bigint | null;
  transactionData: Hex;
};

export type RaterSettlementTransactionEvidence = {
  transactionHash: Hash;
  transactionFrom: Address;
  transactionTo: Address | null;
  transactionData: Hex;
  receiptStatus: "success" | "reverted";
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
};

function invalid(message: string): never {
  throw new Error(message);
}

function exactAddress(value: string, label: string) {
  if (!isAddress(value)) invalid(`${label} is invalid.`);
  return getAddress(value);
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function unsigned(value: string, label: string) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) invalid(`${label} is invalid.`);
  return BigInt(value);
}

export function tokenlessCommitKey(roundId: bigint, voteKey: Address) {
  if (roundId <= 0n) invalid("Round ID is invalid.");
  return keccak256(encodeAbiParameters(COMMIT_KEY_PARAMETERS, [roundId, getAddress(voteKey)]));
}

function bindSnapshot(snapshot: RaterSettlementSnapshot, secrets: TokenlessRaterRoundSecrets) {
  if (snapshot.schemaVersion !== "rateloop.rater-settlement.v1" || snapshot.chainId !== baseSepolia.id) {
    invalid("RateLoop returned an unsupported settlement.");
  }
  const roundId = unsigned(snapshot.roundId, "Settlement round ID");
  if (roundId !== secrets.reveal.roundId) invalid("This recovery package belongs to another settlement round.");
  const voteKey = exactAddress(snapshot.voteKey, "Settlement vote key");
  if (voteKey !== getAddress(secrets.reveal.voteKey)) {
    invalid("This recovery package does not control the committed vote key.");
  }
  const commitKey = tokenlessCommitKey(roundId, voteKey);
  if (!isHash(snapshot.commitKey) || !sameHex(snapshot.commitKey, commitKey)) {
    invalid("The indexed commit key does not match this recovery package.");
  }
  return {
    roundId,
    voteKey,
    commitKey,
    panelAddress: exactAddress(snapshot.panelAddress, "Settlement panel"),
    payoutAddress: getAddress(secrets.reveal.payoutAddress),
  };
}

export function buildRaterRevealAuthorization(input: {
  snapshot: RaterSettlementSnapshot;
  secrets: TokenlessRaterRoundSecrets;
  relayerAddress: string;
}): RaterSettlementAuthorization {
  const bound = bindSnapshot(input.snapshot, input.secrets);
  if (input.snapshot.revealed || !input.snapshot.canReveal) {
    invalid("This review is not currently revealable.");
  }
  return {
    action: "reveal",
    chainId: input.snapshot.chainId,
    panelAddress: bound.panelAddress,
    roundId: bound.roundId,
    voteKey: bound.voteKey,
    commitKey: bound.commitKey,
    payoutAddress: bound.payoutAddress,
    relayerAddress: exactAddress(input.relayerAddress, "Connected relayer wallet"),
    expectedAmountAtomic: null,
    transactionData: encodeFunctionData({
      abi: TokenlessPanelAbi,
      functionName: "reveal",
      args: tokenlessSelfRevealArguments(input.secrets),
    }),
  };
}

export function buildRaterClaimAuthorization(input: {
  snapshot: RaterSettlementSnapshot;
  secrets: TokenlessRaterRoundSecrets;
  relayerAddress: string;
}): RaterSettlementAuthorization {
  const bound = bindSnapshot(input.snapshot, input.secrets);
  if (!input.snapshot.revealed || input.snapshot.claimed || !input.snapshot.canClaim || !input.snapshot.claimKind) {
    invalid("This review is not currently claimable.");
  }
  const expectedAmountAtomic = unsigned(
    input.snapshot.claimKind === "payout" ? input.snapshot.finalizedPayoutAtomic : input.snapshot.compensationAtomic,
    "Expected claim amount",
  );
  if (expectedAmountAtomic <= 0n) invalid("This review has no positive claimable amount.");
  return {
    action: "claim",
    chainId: input.snapshot.chainId,
    panelAddress: bound.panelAddress,
    roundId: bound.roundId,
    voteKey: bound.voteKey,
    commitKey: bound.commitKey,
    payoutAddress: bound.payoutAddress,
    relayerAddress: exactAddress(input.relayerAddress, "Connected relayer wallet"),
    expectedAmountAtomic,
    transactionData: encodeFunctionData({
      abi: TokenlessPanelAbi,
      functionName: input.snapshot.claimKind === "payout" ? "claim" : "claimCompensation",
      args: [bound.commitKey, bound.payoutAddress, input.secrets.reveal.salt],
    }),
  };
}

export function verifyRaterSettlementEvidence(input: {
  authorization: RaterSettlementAuthorization;
  evidence: RaterSettlementTransactionEvidence;
}) {
  const { authorization, evidence } = input;
  if (
    evidence.receiptStatus !== "success" ||
    getAddress(evidence.transactionFrom) !== authorization.relayerAddress ||
    !evidence.transactionTo ||
    getAddress(evidence.transactionTo) !== authorization.panelAddress ||
    !sameHex(evidence.transactionData, authorization.transactionData) ||
    !isHash(evidence.transactionHash)
  ) {
    invalid("The confirmed transaction is not the exact authorized settlement action.");
  }
  const matchingLogs = evidence.logs.filter(log => {
    if (getAddress(log.address) !== authorization.panelAddress) return false;
    try {
      if (authorization.action === "reveal") {
        const decoded = decodeEventLog({
          abi: TokenlessPanelAbi,
          eventName: "RevealAccepted",
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        const args = decoded.args as {
          roundId: bigint;
          commitKey: Hex;
          vote: number;
          predictedUpBps: number;
          responseHash: Hex;
        };
        return args.roundId === authorization.roundId && sameHex(args.commitKey, authorization.commitKey);
      }
      const decoded = decodeEventLog({
        abi: TokenlessPanelAbi,
        eventName: "Claimed",
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as { roundId: bigint; commitKey: Hex; payoutAddress: Address; amount: bigint };
      return (
        args.roundId === authorization.roundId &&
        sameHex(args.commitKey, authorization.commitKey) &&
        getAddress(args.payoutAddress) === authorization.payoutAddress &&
        args.amount === authorization.expectedAmountAtomic
      );
    } catch {
      return false;
    }
  });
  if (matchingLogs.length !== 1) {
    invalid(`The exact ${authorization.action === "reveal" ? "RevealAccepted" : "Claimed"} event was not confirmed.`);
  }
  return { transactionHash: evidence.transactionHash.toLowerCase() as Hash, action: authorization.action };
}
