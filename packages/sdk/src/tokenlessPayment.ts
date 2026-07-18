import { hashStruct, hashTypedData, type Hex } from "viem";
import { RateLoopSdkError } from "./errors";
import {
  TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION,
  type TokenlessDeploymentIdentity,
  type TokenlessPaymentInstructions,
  type TokenlessX402AuthorizationSpec,
} from "./tokenlessTypes";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const MAX_UINT32 = 4_294_967_295n;
const MAX_UINT64 = 18_446_744_073_709_551_615n;

export const TOKENLESS_X402_DOMAIN = {
  name: "RateLoop X402 Panel Submitter",
  version: "1",
} as const;

export const TOKENLESS_EIP3009_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const TOKENLESS_ROUND_TERMS_TYPES = {
  RoundTerms: [
    { name: "contentId", type: "bytes32" },
    { name: "termsHash", type: "bytes32" },
    { name: "beaconNetworkHash", type: "bytes32" },
    { name: "bountyAmount", type: "uint256" },
    { name: "feeAmount", type: "uint256" },
    { name: "attemptReserve", type: "uint256" },
    { name: "attemptCompensation", type: "uint256" },
    { name: "minimumReveals", type: "uint32" },
    { name: "maximumCommits", type: "uint32" },
    { name: "admissionPolicyHash", type: "bytes32" },
    { name: "commitDeadline", type: "uint64" },
    { name: "revealDeadline", type: "uint64" },
    { name: "beaconFailureDeadline", type: "uint64" },
    { name: "beaconRound", type: "uint64" },
    { name: "claimGracePeriod", type: "uint64" },
    { name: "feeRecipient", type: "address" },
  ],
} as const;

export const TOKENLESS_ROUND_AUTHORIZATION_TYPES = {
  RoundAuthorization: [
    { name: "funder", type: "address" },
    { name: "panel", type: "address" },
    { name: "roundTermsDigest", type: "bytes32" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type TokenlessAuthorizationWindow = {
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
};

export type TokenlessRoundTermsMessage = {
  contentId: Hex;
  termsHash: Hex;
  beaconNetworkHash: Hex;
  bountyAmount: bigint;
  feeAmount: bigint;
  attemptReserve: bigint;
  attemptCompensation: bigint;
  minimumReveals: number;
  maximumCommits: number;
  admissionPolicyHash: Hex;
  commitDeadline: bigint;
  revealDeadline: bigint;
  beaconFailureDeadline: bigint;
  beaconRound: bigint;
  claimGracePeriod: bigint;
  feeRecipient: `0x${string}`;
};

export type TokenlessEip3009Message = {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
};

export type TokenlessRoundAuthorizationMessage = {
  funder: `0x${string}`;
  panel: `0x${string}`;
  roundTermsDigest: Hex;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
};

export type TokenlessX402AuthorizationEvidence = TokenlessAuthorizationWindow & {
  v: number;
  r: Hex;
  s: Hex;
  roundAuthorizationSignature: Hex;
};

export type TokenlessEip3009TypedData = {
  domain: TokenlessX402AuthorizationSpec["eip3009Domain"];
  types: typeof TOKENLESS_EIP3009_TYPES;
  primaryType: "ReceiveWithAuthorization";
  message: TokenlessEip3009Message;
};

export type TokenlessRoundTermsTypedData = {
  types: typeof TOKENLESS_ROUND_TERMS_TYPES;
  primaryType: "RoundTerms";
  message: TokenlessRoundTermsMessage;
};

export type TokenlessRoundAuthorizationTypedData = {
  domain: TokenlessX402AuthorizationSpec["roundAuthorizationDomain"];
  types: typeof TOKENLESS_ROUND_AUTHORIZATION_TYPES;
  primaryType: "RoundAuthorization";
  message: TokenlessRoundAuthorizationMessage;
};

export type TokenlessX402AuthorizationBuild = {
  eip3009: TokenlessEip3009TypedData;
  roundTerms: TokenlessRoundTermsTypedData;
  roundAuthorization: TokenlessRoundAuthorizationTypedData;
  roundTermsDigest: Hex;
};

function fail(message: string): never {
  throw new RateLoopSdkError(`Invalid tokenless payment authorization: ${message}`);
}

function address(value: string, path: string): `0x${string}` {
  if (!ADDRESS_PATTERN.test(value)) fail(`${path} must be an EVM address.`);
  return value as `0x${string}`;
}

function bytes32(value: string, path: string): Hex {
  if (!BYTES32_PATTERN.test(value)) fail(`${path} must be a bytes32 hex value.`);
  return value as Hex;
}

function amount(value: string, path: string, max?: bigint): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    fail(`${path} must be an unsigned decimal amount.`);
  }
  const parsed = BigInt(value);
  if (max !== undefined && parsed > max) fail(`${path} exceeds its uint width.`);
  return parsed;
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function assertDomain(
  domain: TokenlessX402AuthorizationSpec["eip3009Domain"],
  instructions: TokenlessPaymentInstructions,
  expectedContract: string,
  path: string,
) {
  if (!domain.name.trim() || !domain.version.trim()) fail(`${path} name/version are required.`);
  if (!Number.isSafeInteger(domain.chainId) || domain.chainId < 1) {
    fail(`${path}.chainId must be a positive safe integer.`);
  }
  if (domain.chainId !== instructions.chainId) {
    fail(`${path}.chainId does not match payment instructions.`);
  }
  address(domain.verifyingContract, `${path}.verifyingContract`);
  if (!sameAddress(domain.verifyingContract, expectedContract)) {
    fail(`${path}.verifyingContract does not match the immutable deployment.`);
  }
}

function assertInstructions(
  instructions: TokenlessPaymentInstructions,
  deployment?: TokenlessDeploymentIdentity,
) {
  if (instructions.paymentMode !== "x402") fail("paymentMode must be x402.");
  if (!instructions.deploymentKey.trim()) fail("deploymentKey is required.");
  if (!Number.isSafeInteger(instructions.chainId) || instructions.chainId < 1) {
    fail("chainId must be a positive safe integer.");
  }
  address(instructions.panelAddress, "panelAddress");
  address(instructions.x402SubmitterAddress, "x402SubmitterAddress");
  address(instructions.usdcAddress, "usdcAddress");
  address(instructions.funderAddress, "funderAddress");
  const terms = instructions.roundTerms;
  bytes32(terms.contentId, "roundTerms.contentId");
  bytes32(terms.termsHash, "roundTerms.termsHash");
  bytes32(terms.beaconNetworkHash, "roundTerms.beaconNetworkHash");
  bytes32(terms.admissionPolicyHash, "roundTerms.admissionPolicyHash");
  address(terms.feeRecipient, "roundTerms.feeRecipient");
  const total = amount(instructions.totalFundedAtomic, "totalFundedAtomic");
  const expectedTotal =
    amount(terms.bountyAmount, "roundTerms.bountyAmount") +
    amount(terms.feeAmount, "roundTerms.feeAmount") +
    amount(terms.attemptReserve, "roundTerms.attemptReserve");
  if (total !== expectedTotal) {
    fail("totalFundedAtomic must equal bountyAmount + feeAmount + attemptReserve.");
  }
  if (!Number.isSafeInteger(terms.minimumReveals) || terms.minimumReveals < 1 || BigInt(terms.minimumReveals) > MAX_UINT32) {
    fail("roundTerms.minimumReveals must be a valid uint32.");
  }
  if (!Number.isSafeInteger(terms.maximumCommits) || terms.maximumCommits < 1 || BigInt(terms.maximumCommits) > MAX_UINT32) {
    fail("roundTerms.maximumCommits must be a valid uint32.");
  }
  for (const [name, value] of [
    ["commitDeadline", terms.commitDeadline],
    ["revealDeadline", terms.revealDeadline],
    ["beaconFailureDeadline", terms.beaconFailureDeadline],
    ["beaconRound", terms.beaconRound],
    ["claimGracePeriod", terms.claimGracePeriod],
  ] as const) amount(value, `roundTerms.${name}`, MAX_UINT64);
  const spec = instructions.authorizationSpec;
  if (!spec) fail("authorizationSpec is required for x402 payment instructions.");
  if (spec.schemaVersion !== TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION) {
    fail("authorizationSpec.schemaVersion is unsupported.");
  }
  assertDomain(
    spec.eip3009Domain,
    instructions,
    instructions.usdcAddress,
    "authorizationSpec.eip3009Domain",
  );
  assertDomain(
    spec.roundAuthorizationDomain,
    instructions,
    instructions.x402SubmitterAddress,
    "authorizationSpec.roundAuthorizationDomain",
  );
  if (deployment) {
    if (instructions.deploymentKey !== deployment.deploymentKey) fail("deploymentKey does not match the active deployment.");
    if (instructions.chainId !== deployment.chainId) fail("chainId does not match the active deployment.");
    if (!sameAddress(instructions.panelAddress, deployment.panelAddress)) fail("panelAddress does not match the active deployment.");
    if (!sameAddress(instructions.x402SubmitterAddress, deployment.x402SubmitterAddress)) fail("x402SubmitterAddress does not match the active deployment.");
    if (!sameAddress(instructions.usdcAddress, deployment.usdcAddress)) fail("usdcAddress does not match the active deployment.");
  }
  return instructions;
}

function requireSpec(instructions: TokenlessPaymentInstructions) {
  assertInstructions(instructions);
  const spec = instructions.authorizationSpec;
  return spec!;
}

function resolveWindow(
  instructions: TokenlessPaymentInstructions,
  input?: TokenlessAuthorizationWindow,
): TokenlessAuthorizationWindow {
  const spec = requireSpec(instructions);
  const candidate = input ?? {
    nonce: spec.nonce,
    validAfter: spec.validAfter,
    validBefore: spec.validBefore,
  };
  const validAfter = amount(candidate.validAfter, "validAfter");
  const validBefore = amount(candidate.validBefore, "validBefore");
  if (validBefore <= validAfter) fail("validBefore must be greater than validAfter.");
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (validBefore <= now) fail("validBefore has expired.");
  if (validBefore - validAfter > 3_600n) fail("authorization lifetime must not exceed one hour.");
  bytes32(candidate.nonce, "nonce");
  if (input && (candidate.validAfter !== spec.validAfter || candidate.validBefore !== spec.validBefore || candidate.nonce.toLowerCase() !== spec.nonce.toLowerCase())) {
    fail("authorization window conflicts with canonical payment instructions.");
  }
  return { validAfter: validAfter.toString(), validBefore: validBefore.toString(), nonce: candidate.nonce };
}

export function validateTokenlessPaymentInstructions(
  instructions: TokenlessPaymentInstructions,
  deployment?: TokenlessDeploymentIdentity,
) {
  return assertInstructions(instructions, deployment);
}

export function buildTokenlessRoundTermsMessage(
  instructions: TokenlessPaymentInstructions,
  deployment?: TokenlessDeploymentIdentity,
): TokenlessRoundTermsMessage {
  assertInstructions(instructions, deployment);
  const terms = instructions.roundTerms;
  return {
    contentId: bytes32(terms.contentId, "roundTerms.contentId"),
    termsHash: bytes32(terms.termsHash, "roundTerms.termsHash"),
    beaconNetworkHash: bytes32(terms.beaconNetworkHash, "roundTerms.beaconNetworkHash"),
    bountyAmount: amount(terms.bountyAmount, "roundTerms.bountyAmount"),
    feeAmount: amount(terms.feeAmount, "roundTerms.feeAmount"),
    attemptReserve: amount(terms.attemptReserve, "roundTerms.attemptReserve"),
    attemptCompensation: amount(terms.attemptCompensation, "roundTerms.attemptCompensation"),
    minimumReveals: terms.minimumReveals,
    maximumCommits: terms.maximumCommits,
    admissionPolicyHash: bytes32(terms.admissionPolicyHash, "roundTerms.admissionPolicyHash"),
    commitDeadline: amount(terms.commitDeadline, "roundTerms.commitDeadline", MAX_UINT64),
    revealDeadline: amount(terms.revealDeadline, "roundTerms.revealDeadline", MAX_UINT64),
    beaconFailureDeadline: amount(terms.beaconFailureDeadline, "roundTerms.beaconFailureDeadline", MAX_UINT64),
    beaconRound: amount(terms.beaconRound, "roundTerms.beaconRound", MAX_UINT64),
    claimGracePeriod: amount(terms.claimGracePeriod, "roundTerms.claimGracePeriod", MAX_UINT64),
    feeRecipient: address(terms.feeRecipient, "roundTerms.feeRecipient"),
  };
}

export function buildTokenlessRoundTermsTypedData(
  instructions: TokenlessPaymentInstructions,
  deployment?: TokenlessDeploymentIdentity,
): TokenlessRoundTermsTypedData {
  return {
    types: TOKENLESS_ROUND_TERMS_TYPES,
    primaryType: "RoundTerms",
    message: buildTokenlessRoundTermsMessage(instructions, deployment),
  };
}

export function hashTokenlessRoundTerms(
  instructions: TokenlessPaymentInstructions,
  deployment?: TokenlessDeploymentIdentity,
): Hex {
  const typedData = buildTokenlessRoundTermsTypedData(instructions, deployment);
  return hashStruct({
    data: typedData.message,
    primaryType: typedData.primaryType,
    types: typedData.types,
  });
}

export function buildTokenlessEip3009TypedData(
  instructions: TokenlessPaymentInstructions,
  input?: TokenlessAuthorizationWindow,
  deployment?: TokenlessDeploymentIdentity,
): TokenlessEip3009TypedData {
  assertInstructions(instructions, deployment);
  const spec = requireSpec(instructions);
  const window = resolveWindow(instructions, input);
  return {
    domain: spec.eip3009Domain,
    types: TOKENLESS_EIP3009_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: address(instructions.funderAddress, "funderAddress"),
      to: address(instructions.x402SubmitterAddress, "x402SubmitterAddress"),
      value: amount(instructions.totalFundedAtomic, "totalFundedAtomic"),
      validAfter: BigInt(window.validAfter),
      validBefore: BigInt(window.validBefore),
      nonce: bytes32(window.nonce, "nonce"),
    },
  };
}

export function buildTokenlessRoundAuthorizationTypedData(
  instructions: TokenlessPaymentInstructions,
  input?: TokenlessAuthorizationWindow,
  deployment?: TokenlessDeploymentIdentity,
): TokenlessRoundAuthorizationTypedData {
  assertInstructions(instructions, deployment);
  const spec = requireSpec(instructions);
  const window = resolveWindow(instructions, input);
  return {
    domain: spec.roundAuthorizationDomain,
    types: TOKENLESS_ROUND_AUTHORIZATION_TYPES,
    primaryType: "RoundAuthorization",
    message: {
      funder: address(instructions.funderAddress, "funderAddress"),
      panel: address(instructions.panelAddress, "panelAddress"),
      roundTermsDigest: hashTokenlessRoundTerms(instructions, deployment),
      validAfter: BigInt(window.validAfter),
      validBefore: BigInt(window.validBefore),
      nonce: bytes32(window.nonce, "nonce"),
    },
  };
}

export function hashTokenlessRoundAuthorization(
  instructions: TokenlessPaymentInstructions,
  input?: TokenlessAuthorizationWindow,
  deployment?: TokenlessDeploymentIdentity,
): Hex {
  const typedData = buildTokenlessRoundAuthorizationTypedData(instructions, input, deployment);
  return hashTypedData(typedData);
}

export function buildTokenlessX402Authorization(
  instructions: TokenlessPaymentInstructions,
  input?: TokenlessAuthorizationWindow,
  deployment?: TokenlessDeploymentIdentity,
): TokenlessX402AuthorizationBuild {
  assertInstructions(instructions, deployment);
  const roundTerms = buildTokenlessRoundTermsTypedData(instructions, deployment);
  const roundTermsDigest = hashTokenlessRoundTerms(instructions, deployment);
  return {
    eip3009: buildTokenlessEip3009TypedData(instructions, input, deployment),
    roundTerms,
    roundAuthorization: buildTokenlessRoundAuthorizationTypedData(instructions, input, deployment),
    roundTermsDigest,
  };
}

export function serializeTokenlessX402Authorization(
  evidence: TokenlessX402AuthorizationEvidence,
): Record<string, unknown> {
  amount(evidence.validAfter, "validAfter");
  amount(evidence.validBefore, "validBefore");
  if (BigInt(evidence.validBefore) <= BigInt(evidence.validAfter)) fail("validBefore must be greater than validAfter.");
  bytes32(evidence.nonce, "nonce");
  if (evidence.v !== 27 && evidence.v !== 28) fail("v must be 27 or 28.");
  bytes32(evidence.r, "r");
  bytes32(evidence.s, "s");
  if (!SIGNATURE_PATTERN.test(evidence.roundAuthorizationSignature)) fail("roundAuthorizationSignature must be a 65-byte signature.");
  return {
    validAfter: evidence.validAfter,
    validBefore: evidence.validBefore,
    nonce: evidence.nonce,
    v: evidence.v,
    r: evidence.r,
    s: evidence.s,
    roundAuthorizationSignature: evidence.roundAuthorizationSignature,
  };
}
