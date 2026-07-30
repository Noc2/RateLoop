import { validateChainPaymentTerms } from "./payments";
import {
  TOKENLESS_MAXIMUM_BEACON_FAILURE_HORIZON_SECONDS,
  TOKENLESS_MAXIMUM_CLAIM_GRACE_SECONDS,
  TOKENLESS_MAXIMUM_REVEAL_HORIZON_SECONDS,
  TOKENLESS_MAX_UINT64,
  TOKENLESS_MAX_UINT256,
  TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS,
  TOKENLESS_QUICKNET_T_CHAIN_HASH,
  TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS,
  type TokenlessPaymentInstructions,
  tokenlessFirstQuicknetRoundAfter,
  tokenlessQuicknetTimestamp,
  validateTokenlessPaymentInstructions,
} from "@rateloop/sdk";
import assert from "node:assert/strict";
import test from "node:test";

const NOW = 2_000_000_000n;
const ZERO_ADDRESS = `0x${"0".repeat(40)}` as const;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;
const PANEL = "0x1111111111111111111111111111111111111111" as const;
const ADAPTER = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x3333333333333333333333333333333333333333" as const;
const FUNDER = "0x4444444444444444444444444444444444444444" as const;
const FEE_RECIPIENT = "0x5555555555555555555555555555555555555555" as const;

function schedule(commitDeadline: bigint, revealDeadline: bigint, beaconFailureDeadline?: bigint) {
  const beaconRound = tokenlessFirstQuicknetRoundAfter(commitDeadline);
  const scoringBeaconRound = tokenlessFirstQuicknetRoundAfter(
    revealDeadline + TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS,
  );
  return {
    commitDeadline: commitDeadline.toString(),
    revealDeadline: revealDeadline.toString(),
    beaconRound: beaconRound.toString(),
    scoringBeaconRound: scoringBeaconRound.toString(),
    beaconFailureDeadline: (
      beaconFailureDeadline ??
      tokenlessQuicknetTimestamp(scoringBeaconRound) + TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS
    ).toString(),
  };
}

function validInstructions(): TokenlessPaymentInstructions {
  return {
    operationKey: "op_payment_terms_invariant",
    paymentMode: "x402",
    paymentState: "awaiting_authorization",
    deploymentKey: "tokenless-v4:test",
    chainId: 84_532,
    panelAddress: PANEL,
    x402SubmitterAddress: ADAPTER,
    usdcAddress: USDC,
    funderAddress: FUNDER,
    totalFundedAtomic: "30",
    roundTerms: {
      contentId: `0x${"11".repeat(32)}`,
      termsHash: `0x${"22".repeat(32)}`,
      beaconNetworkHash: TOKENLESS_QUICKNET_T_CHAIN_HASH,
      bountyAmount: "15",
      feeAmount: "3",
      attemptReserve: "12",
      attemptCompensation: "4",
      minimumReveals: 3,
      maximumCommits: 3,
      admissionPolicyHash: `0x${"44".repeat(32)}`,
      ...schedule(NOW + 300n, NOW + 600n),
      claimGracePeriod: "1",
      feeRecipient: FEE_RECIPIENT,
    },
    roundId: null,
    transactionHash: null,
    authorizationSpec: {
      schemaVersion: "rateloop.tokenless.payment-authorization.v1",
      eip3009Domain: {
        name: "RateLoop Tokenless Test USDC",
        version: "2",
        chainId: 84_532,
        verifyingContract: USDC,
      },
      roundAuthorizationDomain: {
        name: "RateLoop X402 Panel Submitter",
        version: "1",
        chainId: 84_532,
        verifyingContract: ADAPTER,
      },
      validAfter: NOW.toString(),
      validBefore: (NOW + 600n).toString(),
      nonce: `0x${"aa".repeat(32)}`,
    },
  };
}

function acceptedBySdk(input: TokenlessPaymentInstructions) {
  try {
    validateTokenlessPaymentInstructions(input, undefined, {
      nowSeconds: NOW,
    });
    return true;
  } catch {
    return false;
  }
}

function acceptedByServer(input: TokenlessPaymentInstructions) {
  try {
    validateChainPaymentTerms(input, NOW);
    return true;
  } catch {
    return false;
  }
}

type BoundaryCase = {
  accepted: boolean;
  mutate: (input: TokenlessPaymentInstructions) => void;
  name: string;
};

const cases: BoundaryCase[] = [
  { name: "exact minimum boundaries", accepted: true, mutate: () => {} },
  {
    name: "maximum commits and claim grace",
    accepted: true,
    mutate: input => {
      input.roundTerms.maximumCommits = 500;
      input.roundTerms.bountyAmount = "2500";
      input.roundTerms.feeAmount = "500";
      input.roundTerms.attemptCompensation = "4";
      input.roundTerms.attemptReserve = "2000";
      input.roundTerms.claimGracePeriod = TOKENLESS_MAXIMUM_CLAIM_GRACE_SECONDS.toString();
      input.totalFundedAtomic = "5000";
    },
  },
  {
    name: "zero fee with a zero recipient",
    accepted: true,
    mutate: input => {
      input.roundTerms.feeAmount = "0";
      input.roundTerms.feeRecipient = ZERO_ADDRESS;
      input.totalFundedAtomic = "27";
    },
  },
  {
    name: "under quorum",
    accepted: false,
    mutate: input => {
      input.roundTerms.minimumReveals = 2;
    },
  },
  {
    name: "commit capacity below quorum",
    accepted: false,
    mutate: input => {
      input.roundTerms.maximumCommits = 2;
    },
  },
  {
    name: "commit capacity over immutable maximum",
    accepted: false,
    mutate: input => {
      input.roundTerms.maximumCommits = 501;
    },
  },
  {
    name: "zero fixed base",
    accepted: false,
    mutate: input => {
      input.roundTerms.bountyAmount = "3";
      input.roundTerms.feeAmount = "0";
      input.roundTerms.attemptCompensation = "0";
      input.roundTerms.attemptReserve = "0";
      input.totalFundedAtomic = "3";
    },
  },
  {
    name: "attempt compensation differs from fixed base",
    accepted: false,
    mutate: input => {
      input.roundTerms.attemptCompensation = "3";
    },
  },
  {
    name: "attempt reserve cannot cover every commit",
    accepted: false,
    mutate: input => {
      input.roundTerms.attemptReserve = "11";
      input.totalFundedAtomic = "29";
    },
  },
  {
    name: "funded total is not conserved",
    accepted: false,
    mutate: input => {
      input.totalFundedAtomic = "29";
    },
  },
  {
    name: "fee exceeds immutable cap",
    accepted: false,
    mutate: input => {
      input.roundTerms.feeAmount = "4";
      input.totalFundedAtomic = "31";
    },
  },
  {
    name: "non-zero fee has no recipient",
    accepted: false,
    mutate: input => {
      input.roundTerms.feeRecipient = ZERO_ADDRESS;
    },
  },
  {
    name: "zero content commitment",
    accepted: false,
    mutate: input => {
      input.roundTerms.contentId = ZERO_BYTES32;
    },
  },
  {
    name: "zero terms commitment",
    accepted: false,
    mutate: input => {
      input.roundTerms.termsHash = ZERO_BYTES32;
    },
  },
  {
    name: "zero admission-policy commitment",
    accepted: false,
    mutate: input => {
      input.roundTerms.admissionPolicyHash = ZERO_BYTES32;
    },
  },
  {
    name: "zero claim grace",
    accepted: false,
    mutate: input => {
      input.roundTerms.claimGracePeriod = "0";
    },
  },
  {
    name: "claim grace beyond immutable maximum",
    accepted: false,
    mutate: input => {
      input.roundTerms.claimGracePeriod = (TOKENLESS_MAXIMUM_CLAIM_GRACE_SECONDS + 1n).toString();
    },
  },
  {
    name: "commit window below immutable minimum",
    accepted: false,
    mutate: input => {
      Object.assign(input.roundTerms, schedule(NOW + 299n, NOW + 599n));
    },
  },
  {
    name: "reveal window below immutable minimum",
    accepted: false,
    mutate: input => {
      Object.assign(input.roundTerms, schedule(NOW + 300n, NOW + 599n));
    },
  },
  {
    name: "reveal horizon beyond immutable maximum",
    accepted: false,
    mutate: input => {
      const reveal = NOW + TOKENLESS_MAXIMUM_REVEAL_HORIZON_SECONDS + 1n;
      Object.assign(input.roundTerms, schedule(NOW + 300n, reveal));
    },
  },
  {
    name: "beacon failure horizon beyond immutable maximum",
    accepted: false,
    mutate: input => {
      input.roundTerms.beaconFailureDeadline = (NOW + TOKENLESS_MAXIMUM_BEACON_FAILURE_HORIZON_SECONDS + 1n).toString();
    },
  },
  {
    name: "disclosure beacon is not the first eligible round",
    accepted: false,
    mutate: input => {
      input.roundTerms.beaconRound = (BigInt(input.roundTerms.beaconRound) + 1n).toString();
    },
  },
  {
    name: "scoring beacon is not the first protected round",
    accepted: false,
    mutate: input => {
      input.roundTerms.scoringBeaconRound = (BigInt(input.roundTerms.scoringBeaconRound) + 1n).toString();
    },
  },
  {
    name: "beacon failure grace below immutable minimum",
    accepted: false,
    mutate: input => {
      input.roundTerms.beaconFailureDeadline = (
        tokenlessQuicknetTimestamp(BigInt(input.roundTerms.scoringBeaconRound)) +
        TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS -
        1n
      ).toString();
    },
  },
  {
    name: "wrong beacon network",
    accepted: false,
    mutate: input => {
      input.roundTerms.beaconNetworkHash = `0x${"ff".repeat(32)}`;
    },
  },
  {
    name: "uint64 deadline overflow",
    accepted: false,
    mutate: input => {
      input.roundTerms.commitDeadline = (TOKENLESS_MAX_UINT64 + 1n).toString();
    },
  },
  {
    name: "uint256 fixed-base arithmetic overflow",
    accepted: false,
    mutate: input => {
      input.roundTerms.bountyAmount = TOKENLESS_MAX_UINT256.toString();
      input.totalFundedAtomic = TOKENLESS_MAX_UINT256.toString();
    },
  },
  {
    name: "uint256 funded-total overflow",
    accepted: false,
    mutate: input => {
      input.roundTerms.attemptReserve = TOKENLESS_MAX_UINT256.toString();
      input.totalFundedAtomic = TOKENLESS_MAX_UINT256.toString();
    },
  },
  {
    name: "unpinned x402 domain name",
    accepted: false,
    mutate: input => {
      input.authorizationSpec!.roundAuthorizationDomain.name = "Lookalike X402 Submitter";
    },
  },
  {
    name: "unpinned x402 domain version",
    accepted: false,
    mutate: input => {
      input.authorizationSpec!.roundAuthorizationDomain.version = "2";
    },
  },
];

test("SDK signing and server preparation share every immutable payment-term boundary", () => {
  for (const boundary of cases) {
    const input = structuredClone(validInstructions());
    boundary.mutate(input);
    const sdkAccepted = acceptedBySdk(input);
    const serverAccepted = acceptedByServer(input);
    assert.equal(sdkAccepted, serverAccepted, `${boundary.name}: SDK and server disagree`);
    assert.equal(sdkAccepted, boundary.accepted, `${boundary.name}: unexpected boundary result`);
  }
});
