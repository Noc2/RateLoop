import deployedContracts from "@rateloop/contracts/deployedContracts";
import { USDC_BY_CHAIN_ID } from "@rateloop/contracts/protocol";
import { randomBytes, timingSafeEqual } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import "server-only";
import {
  type Abi,
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  isHash,
  isHex,
  parseAbi,
  parseEventLogs,
  toHex,
} from "viem";
import { parseTags } from "~~/constants/categories";
import { getImageAttachmentSubmissionValidationError } from "~~/lib/attachments/imageAttachments";
import {
  MAX_SUBMISSION_IMAGE_URLS,
  isUploadedImageUrl,
  isYouTubeVideoUrl,
  normalizeSubmissionContextUrl,
  normalizeSubmissionMediaUrl,
} from "~~/lib/contentMedia";
import { db } from "~~/lib/db";
import { freeTransactionQuotas, freeTransactionReservations } from "~~/lib/db/schema";
import {
  getFreeTransactionLimit,
  getServerEnvironmentScope,
  getServerRpcOverrides,
  getServerTargetNetworkById,
  getX402UsdcAddressOverride,
} from "~~/lib/env/server";
import { findBlockedContentTags, getContentTitleValidationError } from "~~/lib/moderation/submissionValidation";
import { buildFreeTransactionOperationKey } from "~~/lib/thirdweb/freeTransactionOperation";
import { isFreeTransactionStoreUnavailableError } from "~~/lib/thirdweb/freeTransactionStoreFallback";
import { sanitizeExternalUrl } from "~~/utils/externalUrl";

type DeployedContractsMap = Record<
  number,
  Record<
    string,
    {
      address: Address;
      abi: Abi;
    }
  >
>;

export type ThirdwebVerifierUserOp = {
  sender?: string;
  factory?: string;
  factoryData?: string;
  initCode?: string;
  targets?: string[];
  gasLimit?: string;
  gasPrice?: string;
  data?: {
    targets?: string[];
    callDatas?: string[];
    values?: string[];
  };
};

type ThirdwebVerifierRequest = {
  clientId?: string;
  chainId?: number;
  userOp?: ThirdwebVerifierUserOp;
};

type FreeTransactionDbWrite = Pick<typeof db, "insert" | "select" | "update">;
type ResolveRaterIdentityKey = (address: `0x${string}`, chainId: number) => Promise<string | null>;
type GetVerifiedThirdwebSmartAccountAdminAddresses = (params: {
  chainId: number;
  userOp?: ThirdwebVerifierUserOp;
  walletAddress: `0x${string}`;
}) => Promise<readonly `0x${string}`[]>;
type CheckTransactionHashesSucceeded = (params: {
  chainId: number;
  transactionHashes: Hash[];
  walletAddress: `0x${string}`;
}) => Promise<boolean>;
type TransactionVerificationLog = {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
};
type TransactionVerificationClient = {
  getTransaction: (params: { hash: Hash }) => Promise<{ chainId: bigint | number; from: Address }>;
  getTransactionReceipt: (params: {
    hash: Hash;
  }) => Promise<{ logs: readonly TransactionVerificationLog[]; status: "reverted" | "success" }>;
};
type GetTransactionVerificationClient = (chainId: number) => Promise<TransactionVerificationClient | null>;

export type FreeTransactionAllowanceSummary = {
  chainId: number;
  environment: string;
  limit: number;
  used: number;
  remaining: number;
  verified: boolean;
  exhausted: boolean;
  walletAddress: `0x${string}` | null;
  raterIdentityKey: string | null;
};

export type FreeTransactionAllowanceDecision =
  | {
      isAllowed: true;
      summary: FreeTransactionAllowanceSummary;
      reservationSessionToken?: string;
      debugCode?: string;
    }
  | {
      isAllowed: false;
      reason: string;
      summary?: FreeTransactionAllowanceSummary;
      debugCode:
        | "invalid_chain"
        | "invalid_sender"
        | "invalid_targets"
        | "target_not_allowlisted"
        | "unsupported_operation"
        | "invalid_operation_key"
        | "missing_rater_identity"
        | "free_tx_exhausted"
        | "quota_store_unavailable";
    };

export type FreeTransactionConfirmationOutcome =
  | "confirmed"
  | "already_confirmed"
  | "missing_reservation"
  | "reservation_mismatch"
  | "unknown"
  | "update_skipped"
  | `ignored_${string}`;

export type FreeTransactionConfirmationResult = {
  confirmed: boolean;
  outcome: FreeTransactionConfirmationOutcome;
};

const DEFAULT_DENY_REASON = "Transaction not sponsored.";
const FREE_TX_EXHAUSTED_REASON = "Free transactions used up. Add ETH to continue.";
const NO_RATER_IDENTITY_REASON = "Verify your ID to unlock free transactions.";
const FRONTEND_REGISTRATION_STAKE_AMOUNT = 1000_000_000n;
const MAX_CONTENT_TAGS_LENGTH = 256;
const FREE_TRANSACTION_RESERVATION_TTL_MS = 5 * 60_000;
const FREE_TRANSACTION_IDEMPOTENCY_WINDOW_MS = 2 * 60_000;
const FREE_TRANSACTION_RESERVATION_SESSION_TOKEN_BYTES = 32;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}`;
const ALLOWED_APPROVE_TOKEN_NAMES = new Set(["LoopReputation", "MockERC20", "USDC"]);
const USER_OPERATION_RECEIPT_EVENT_ABI = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);
const EXECUTED_RECEIPT_EVENT_ABI = parseAbi([
  "event Executed(address indexed user, address indexed signer, address indexed executor, uint256 batchSize)",
]);
const THIRDWEB_ACCOUNT_FACTORY_ABI = parseAbi([
  "function createAccount(address admin, bytes data) returns (address)",
  "function getAccountsOfSigner(address signer) view returns (address[])",
  "function getAddress(address adminSigner, bytes data) view returns (address)",
]);
const THIRDWEB_ACCOUNT_PERMISSIONS_ABI = parseAbi(["function getAllAdmins() view returns (address[])"]);
const THIRDWEB_DEFAULT_ACCOUNT_FACTORY_ADDRESSES = [
  "0x85e23b94e7F5E9cC1fF78BCe78cfb15B81f0DF00",
  "0x4be0ddfebca9a5a4a617dee4dece99e7c862dceb",
] as const satisfies readonly Address[];
const THIRDWEB_DEFAULT_ACCOUNT_FACTORY_ADDRESS_SET = new Set(
  THIRDWEB_DEFAULT_ACCOUNT_FACTORY_ADDRESSES.map(address => address.toLowerCase()),
);
const CONTENT_REGISTRY_SUBMISSION_ABI = [
  {
    type: "function",
    name: "cancelReservedSubmission",
    inputs: [{ name: "revealCommitment", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reserveSubmission",
    inputs: [{ name: "revealCommitment", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitQuestion",
    inputs: [
      { name: "contextUrl", type: "string" },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
      { name: "title", type: "string" },
      { name: "tags", type: "string" },
      { name: "categoryId", type: "uint256" },
      {
        name: "details",
        type: "tuple",
        components: [
          { name: "detailsUrl", type: "string" },
          { name: "detailsHash", type: "bytes32" },
        ],
      },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitQuestionWithRewardAndRoundConfig",
    inputs: [
      { name: "contextUrl", type: "string" },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
      { name: "title", type: "string" },
      { name: "tags", type: "string" },
      { name: "categoryId", type: "uint256" },
      {
        name: "details",
        type: "tuple",
        components: [
          { name: "detailsUrl", type: "string" },
          { name: "detailsHash", type: "bytes32" },
        ],
      },
      { name: "salt", type: "bytes32" },
      {
        name: "rewardTerms",
        type: "tuple",
        components: [
          { name: "asset", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "requiredVoters", type: "uint256" },
          { name: "requiredSettledRounds", type: "uint256" },
          { name: "bountyStartBy", type: "uint256" },
          { name: "bountyWindowSeconds", type: "uint256" },
          { name: "feedbackWindowSeconds", type: "uint256" },
          { name: "bountyEligibility", type: "uint8" },
        ],
      },
      {
        name: "roundConfig",
        type: "tuple",
        components: [
          { name: "epochDuration", type: "uint32" },
          { name: "maxDuration", type: "uint32" },
          { name: "minVoters", type: "uint16" },
          { name: "maxVoters", type: "uint16" },
        ],
      },
      {
        name: "spec",
        type: "tuple",
        components: [
          { name: "questionMetadataHash", type: "bytes32" },
          { name: "resultSpecHash", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitQuestionWithRewardAndRoundConfig",
    inputs: [
      { name: "contextUrl", type: "string" },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
      { name: "title", type: "string" },
      { name: "tags", type: "string" },
      { name: "categoryId", type: "uint256" },
      {
        name: "details",
        type: "tuple",
        components: [
          { name: "detailsUrl", type: "string" },
          { name: "detailsHash", type: "bytes32" },
        ],
      },
      { name: "salt", type: "bytes32" },
      {
        name: "rewardTerms",
        type: "tuple",
        components: [
          { name: "asset", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "requiredVoters", type: "uint256" },
          { name: "requiredSettledRounds", type: "uint256" },
          { name: "bountyStartBy", type: "uint256" },
          { name: "bountyWindowSeconds", type: "uint256" },
          { name: "feedbackWindowSeconds", type: "uint256" },
          { name: "bountyEligibility", type: "uint8" },
        ],
      },
      {
        name: "roundConfig",
        type: "tuple",
        components: [
          { name: "epochDuration", type: "uint32" },
          { name: "maxDuration", type: "uint32" },
          { name: "minVoters", type: "uint16" },
          { name: "maxVoters", type: "uint16" },
        ],
      },
      {
        name: "spec",
        type: "tuple",
        components: [
          { name: "questionMetadataHash", type: "bytes32" },
          { name: "resultSpecHash", type: "bytes32" },
        ],
      },
      {
        name: "confidentiality",
        type: "tuple",
        components: [
          { name: "gated", type: "bool" },
          { name: "bondAsset", type: "uint8" },
          { name: "bondAmount", type: "uint64" },
          { name: "flags", type: "uint8" },
        ],
      },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitQuestionBundleWithRewardAndRoundConfig",
    inputs: [
      {
        name: "questions",
        type: "tuple[]",
        components: [
          { name: "contextUrl", type: "string" },
          { name: "imageUrls", type: "string[]" },
          { name: "videoUrl", type: "string" },
          { name: "title", type: "string" },
          { name: "tags", type: "string" },
          { name: "categoryId", type: "uint256" },
          {
            name: "details",
            type: "tuple",
            components: [
              { name: "detailsUrl", type: "string" },
              { name: "detailsHash", type: "bytes32" },
            ],
          },
          { name: "salt", type: "bytes32" },
          {
            name: "spec",
            type: "tuple",
            components: [
              { name: "questionMetadataHash", type: "bytes32" },
              { name: "resultSpecHash", type: "bytes32" },
            ],
          },
        ],
      },
      {
        name: "rewardTerms",
        type: "tuple",
        components: [
          { name: "asset", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "requiredVoters", type: "uint256" },
          { name: "requiredSettledRounds", type: "uint256" },
          { name: "bountyStartBy", type: "uint256" },
          { name: "bountyWindowSeconds", type: "uint256" },
          { name: "feedbackWindowSeconds", type: "uint256" },
          { name: "bountyEligibility", type: "uint8" },
        ],
      },
      {
        name: "roundConfig",
        type: "tuple",
        components: [
          { name: "epochDuration", type: "uint32" },
          { name: "maxDuration", type: "uint32" },
          { name: "minVoters", type: "uint16" },
          { name: "maxVoters", type: "uint16" },
        ],
      },
    ],
    outputs: [
      { name: "bundleId", type: "uint256" },
      { name: "contentIds", type: "uint256[]" },
    ],
    stateMutability: "nonpayable",
  },
] as const;

let ensureFreeTransactionQuotaTablePromise: Promise<void> | null = null;
let freeTransactionTestOverrides: {
  resolveRaterIdentityKey?: ResolveRaterIdentityKey;
  getVerifiedThirdwebSmartAccountAdminAddresses?: GetVerifiedThirdwebSmartAccountAdminAddresses;
  allTransactionHashesSucceeded?: CheckTransactionHashesSucceeded;
  getTransactionVerificationClient?: GetTransactionVerificationClient;
} | null = null;

function getContractsForChain(chainId: number) {
  return (deployedContracts as unknown as Partial<DeployedContractsMap>)[chainId];
}

function buildIdentityKey(params: { chainId: number; environment: string; raterIdentityKey: string }) {
  return `${params.environment}:${params.chainId}:${params.raterIdentityKey}`;
}

function normalizeAddress(value: string): `0x${string}` {
  return getAddress(value) as `0x${string}`;
}

function getTimestampMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function isCallableAbi(abi: Abi) {
  return abi.some(entry => entry.type === "function");
}

function getContractsByAddress(chainId: number): Map<string, { name: string; address: Address; abi: Abi }> {
  const contracts = getContractsForChain(chainId);
  if (!contracts) {
    return new Map();
  }

  return new Map(
    Object.entries(contracts)
      .filter(([name, contract]) => !name.endsWith("Lib") && isCallableAbi(contract.abi))
      .map(([name, contract]) => [
        contract.address.toLowerCase(),
        { name, address: contract.address, abi: contract.abi },
      ]),
  );
}

function getKnownUsdcContractForCall(
  chainId: number,
  address: Address,
): { name: string; address: Address; abi: Abi } | undefined {
  const usdcAddress = getX402UsdcAddressOverride(chainId) ?? USDC_BY_CHAIN_ID[chainId];
  if (!usdcAddress || usdcAddress.toLowerCase() !== address.toLowerCase()) {
    return undefined;
  }

  return {
    name: "USDC",
    address: getAddress(usdcAddress),
    abi: erc20Abi,
  };
}

function decodeContentRegistryCallData(data: Hex) {
  return decodeFunctionData({
    abi: CONTENT_REGISTRY_SUBMISSION_ABI,
    data,
  }) as { functionName: string; args: readonly unknown[] | undefined };
}

function getRpcUrl(chainId: number) {
  const network = getServerTargetNetworkById(chainId);
  if (!network) {
    return null;
  }

  const rpcOverrides = getServerRpcOverrides();
  return rpcOverrides[chainId] ?? network.rpcUrls.default.http[0] ?? null;
}

async function getPublicClientForChain(chainId: number) {
  const network = getServerTargetNetworkById(chainId);
  const rpcUrl = getRpcUrl(chainId);

  if (!network || !rpcUrl) {
    return null;
  }

  return createPublicClient({
    chain: network,
    transport: http(rpcUrl),
  });
}

type ChainPublicClient = NonNullable<Awaited<ReturnType<typeof getPublicClientForChain>>>;
type ThirdwebSmartAccountAdminCandidate = {
  accountData: Hex;
  adminAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  factoryData: Hex;
};

function getKnownThirdwebAccountFactoryAddress(value: string | undefined): `0x${string}` | null {
  if (!value || !isAddress(value)) {
    return null;
  }

  const factoryAddress = normalizeAddress(value);
  return THIRDWEB_DEFAULT_ACCOUNT_FACTORY_ADDRESS_SET.has(factoryAddress.toLowerCase()) ? factoryAddress : null;
}

function decodeThirdwebSmartAccountCreateAccount(
  factoryAddress: `0x${string}`,
  factoryData: string | undefined,
): ThirdwebSmartAccountAdminCandidate | null {
  if (!factoryData || !isHex(factoryData)) {
    return null;
  }

  try {
    const decoded = decodeFunctionData({
      abi: THIRDWEB_ACCOUNT_FACTORY_ABI,
      data: factoryData,
    }) as { args: readonly unknown[] | undefined; functionName: string };
    if (decoded.functionName !== "createAccount") {
      return null;
    }

    const adminAddress = normalizeAddressArg(decoded.args?.[0]);
    const accountData = decoded.args?.[1];
    if (!adminAddress || typeof accountData !== "string" || !isHex(accountData)) {
      return null;
    }

    return {
      accountData,
      adminAddress,
      factoryAddress,
      factoryData,
    };
  } catch {
    return null;
  }
}

export function extractThirdwebSmartAccountAdminCandidate(
  userOp: ThirdwebVerifierUserOp | undefined,
): ThirdwebSmartAccountAdminCandidate | null {
  const factoryAddress = getKnownThirdwebAccountFactoryAddress(userOp?.factory);
  if (factoryAddress) {
    const candidate = decodeThirdwebSmartAccountCreateAccount(factoryAddress, userOp?.factoryData);
    if (candidate) {
      return candidate;
    }
  }

  const initCode = userOp?.initCode;
  if (!initCode || !isHex(initCode) || initCode.length <= 42) {
    return null;
  }

  const initCodeFactoryAddress = getKnownThirdwebAccountFactoryAddress(`0x${initCode.slice(2, 42)}`);
  if (!initCodeFactoryAddress) {
    return null;
  }

  return decodeThirdwebSmartAccountCreateAccount(initCodeFactoryAddress, `0x${initCode.slice(42)}`);
}

async function readThirdwebFactoryAccountsOfSigner(params: {
  adminAddress: `0x${string}`;
  client: ChainPublicClient;
  factoryAddress: `0x${string}`;
}) {
  const accounts = await params.client
    .readContract({
      address: params.factoryAddress,
      abi: THIRDWEB_ACCOUNT_FACTORY_ABI,
      functionName: "getAccountsOfSigner",
      args: [params.adminAddress],
    })
    .catch(() => null);

  if (!Array.isArray(accounts)) {
    return [];
  }

  return accounts
    .filter((account): account is string => typeof account === "string" && isAddress(account))
    .map(account => normalizeAddress(account));
}

async function readThirdwebFactoryPredictedAccount(params: {
  accountData: Hex;
  adminAddress: `0x${string}`;
  client: ChainPublicClient;
  factoryAddress: `0x${string}`;
}) {
  const accountAddress = await params.client
    .readContract({
      address: params.factoryAddress,
      abi: THIRDWEB_ACCOUNT_FACTORY_ABI,
      functionName: "getAddress",
      args: [params.adminAddress, params.accountData],
    })
    .catch(() => null);

  return typeof accountAddress === "string" && isAddress(accountAddress) ? normalizeAddress(accountAddress) : null;
}

async function readThirdwebSmartAccountAdmins(params: { client: ChainPublicClient; walletAddress: `0x${string}` }) {
  const admins = await params.client
    .readContract({
      address: params.walletAddress,
      abi: THIRDWEB_ACCOUNT_PERMISSIONS_ABI,
      functionName: "getAllAdmins",
    })
    .catch(() => null);

  if (!Array.isArray(admins)) {
    return [];
  }

  return admins
    .filter((admin): admin is string => typeof admin === "string" && isAddress(admin))
    .map(admin => normalizeAddress(admin));
}

async function isVerifiedThirdwebSmartAccountForAdmin(params: {
  adminAddress: `0x${string}`;
  candidate?: ThirdwebSmartAccountAdminCandidate | null;
  client: ChainPublicClient;
  walletAddress: `0x${string}`;
}) {
  const normalizedWalletAddress = params.walletAddress.toLowerCase();

  for (const factoryAddress of THIRDWEB_DEFAULT_ACCOUNT_FACTORY_ADDRESSES) {
    if (params.candidate?.factoryAddress.toLowerCase() === factoryAddress.toLowerCase()) {
      const predictedAccount = await readThirdwebFactoryPredictedAccount({
        accountData: params.candidate.accountData,
        adminAddress: params.adminAddress,
        client: params.client,
        factoryAddress,
      });
      if (predictedAccount?.toLowerCase() === normalizedWalletAddress) {
        return true;
      }
    }

    const accounts = await readThirdwebFactoryAccountsOfSigner({
      adminAddress: params.adminAddress,
      client: params.client,
      factoryAddress,
    });
    if (accounts.some(account => account.toLowerCase() === normalizedWalletAddress)) {
      return true;
    }
  }

  return false;
}

function dedupeNormalizedAddresses(addresses: readonly `0x${string}`[]) {
  const deduped = new Map<string, `0x${string}`>();
  for (const address of addresses) {
    deduped.set(address.toLowerCase(), address);
  }

  return [...deduped.values()];
}

async function getVerifiedThirdwebSmartAccountAdminAddresses(params: {
  chainId: number;
  userOp?: ThirdwebVerifierUserOp;
  walletAddress: `0x${string}`;
}) {
  if (freeTransactionTestOverrides?.getVerifiedThirdwebSmartAccountAdminAddresses) {
    const overrideAddresses = await freeTransactionTestOverrides.getVerifiedThirdwebSmartAccountAdminAddresses(params);
    return dedupeNormalizedAddresses(
      overrideAddresses
        .filter((address): address is `0x${string}` => typeof address === "string" && isAddress(address))
        .map(address => normalizeAddress(address)),
    );
  }

  const client = await getPublicClientForChain(params.chainId);
  if (!client) {
    return [];
  }

  const candidate = extractThirdwebSmartAccountAdminCandidate(params.userOp);
  const adminAddresses: `0x${string}`[] = [];

  if (
    candidate &&
    (await isVerifiedThirdwebSmartAccountForAdmin({
      adminAddress: candidate.adminAddress,
      candidate,
      client,
      walletAddress: params.walletAddress,
    }))
  ) {
    adminAddresses.push(candidate.adminAddress);
  }

  const deployedAdmins = await readThirdwebSmartAccountAdmins({
    client,
    walletAddress: params.walletAddress,
  });
  for (const adminAddress of deployedAdmins) {
    const isVerifiedAdmin = await isVerifiedThirdwebSmartAccountForAdmin({
      adminAddress,
      candidate: candidate?.adminAddress.toLowerCase() === adminAddress.toLowerCase() ? candidate : null,
      client,
      walletAddress: params.walletAddress,
    });
    if (isVerifiedAdmin) {
      adminAddresses.push(adminAddress);
    }
  }

  return dedupeNormalizedAddresses(adminAddresses);
}

async function getTransactionVerificationClient(chainId: number): Promise<TransactionVerificationClient | null> {
  if (freeTransactionTestOverrides?.getTransactionVerificationClient) {
    return freeTransactionTestOverrides.getTransactionVerificationClient(chainId);
  }

  const client = await getPublicClientForChain(chainId);
  if (!client) {
    return null;
  }

  return {
    getTransaction: async params => {
      const transaction = await client.getTransaction(params);
      const transactionChainId = "chainId" in transaction ? transaction.chainId : undefined;

      return {
        chainId:
          typeof transactionChainId === "bigint" || typeof transactionChainId === "number"
            ? transactionChainId
            : Number.NaN,
        from: transaction.from,
      };
    },
    getTransactionReceipt: params => client.getTransactionReceipt(params),
  };
}

async function resolveRaterIdentityKey(address: `0x${string}`, chainId: number) {
  const client = await getPublicClientForChain(chainId);
  const contracts = getContractsForChain(chainId);
  const raterRegistry = contracts?.RaterRegistry;

  if (!client || !raterRegistry) {
    return null;
  }

  const resolvedRater = await client
    .readContract({
      address: raterRegistry.address,
      abi: raterRegistry.abi,
      functionName: "resolveRater",
      args: [address],
    })
    .catch(() => null);

  if (!resolvedRater) {
    return null;
  }

  const resolved = resolvedRater as
    | { identityKey?: `0x${string}`; hasActiveHumanCredential?: boolean }
    | readonly [`0x${string}`, `0x${string}`, `0x${string}`, boolean, boolean];
  const identityKey = Array.isArray(resolved)
    ? (resolved as readonly [`0x${string}`, `0x${string}`, `0x${string}`, boolean, boolean])[1]
    : (resolved as { identityKey?: `0x${string}` }).identityKey;
  const hasActiveHumanCredential = Array.isArray(resolved)
    ? (resolved as readonly [`0x${string}`, `0x${string}`, `0x${string}`, boolean, boolean])[3]
    : (resolved as { hasActiveHumanCredential?: boolean }).hasActiveHumanCredential;

  if (
    !hasActiveHumanCredential ||
    !identityKey ||
    !/^0x[0-9a-fA-F]{64}$/.test(identityKey) ||
    /^0x0{64}$/.test(identityKey)
  ) {
    return null;
  }

  return identityKey.toLowerCase();
}

async function resolveConfiguredRaterIdentityKey(address: `0x${string}`, chainId: number) {
  return (freeTransactionTestOverrides?.resolveRaterIdentityKey ?? resolveRaterIdentityKey)(address, chainId);
}

async function resolveFreeTransactionRaterIdentityKey(params: {
  chainId: number;
  userOp?: ThirdwebVerifierUserOp;
  walletAddress: `0x${string}`;
}) {
  const directIdentityKey = await resolveConfiguredRaterIdentityKey(params.walletAddress, params.chainId);
  if (directIdentityKey) {
    return directIdentityKey;
  }

  const adminAddresses = await getVerifiedThirdwebSmartAccountAdminAddresses(params);
  for (const adminAddress of adminAddresses) {
    const adminIdentityKey = await resolveConfiguredRaterIdentityKey(adminAddress, params.chainId);
    if (adminIdentityKey) {
      return adminIdentityKey;
    }
  }

  return null;
}

async function ensureQuotaRow(
  database: FreeTransactionDbWrite,
  params: {
    chainId: number;
    environment: string;
    raterIdentityKey: string;
    walletAddress: `0x${string}`;
  },
) {
  const now = new Date();
  const freeTxLimit = getFreeTransactionLimit();
  const identityKey = buildIdentityKey(params);

  await database
    .insert(freeTransactionQuotas)
    .values({
      identityKey,
      raterIdentityKey: params.raterIdentityKey,
      chainId: params.chainId,
      environment: params.environment,
      lastWalletAddress: params.walletAddress,
      freeTxLimit,
      freeTxUsed: 0,
      exhaustedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  return identityKey;
}

function buildQuotaSummary(params: {
  chainId: number;
  environment: string;
  freeTxLimit: number;
  freeTxUsed: number;
  raterIdentityKey: string;
  walletAddress: `0x${string}`;
}) {
  const used = params.freeTxUsed;

  return {
    chainId: params.chainId,
    environment: params.environment,
    limit: params.freeTxLimit,
    used,
    remaining: Math.max(params.freeTxLimit - used, 0),
    verified: true,
    exhausted: used >= params.freeTxLimit,
    walletAddress: params.walletAddress,
    raterIdentityKey: params.raterIdentityKey,
  } satisfies FreeTransactionAllowanceSummary;
}

function normalizeQuotaRow(
  row:
    | {
        chainId?: number | string | null;
        chain_id?: number | string | null;
        chainid?: number | string | null;
        environment?: string | null;
        freeTxLimit?: number | string | null;
        free_tx_limit?: number | string | null;
        freetxlimit?: number | string | null;
        freeTxUsed?: number | string | null;
        free_tx_used?: number | string | null;
        freetxused?: number | string | null;
        raterIdentityKey?: string | null;
        rater_identity_key?: string | null;
        rateridentitykey?: string | null;
      }
    | null
    | undefined,
) {
  if (!row) {
    return null;
  }

  return {
    chainId: Number(row.chainId ?? row.chain_id ?? row.chainid),
    environment: row.environment ?? "",
    freeTxLimit: Number(row.freeTxLimit ?? row.free_tx_limit ?? row.freetxlimit),
    freeTxUsed: Number(row.freeTxUsed ?? row.free_tx_used ?? row.freetxused),
    raterIdentityKey: row.raterIdentityKey ?? row.rater_identity_key ?? row.rateridentitykey ?? "",
  };
}

function normalizeReservationRow(
  row:
    | {
        chainId?: number | string | null;
        chain_id?: number | string | null;
        chainid?: number | string | null;
        walletAddress?: string | null;
        wallet_address?: string | null;
        walletaddress?: string | null;
        reservationSessionToken?: string | null;
        reservation_session_token?: string | null;
        reservationsessiontoken?: string | null;
        status?: string | null;
        confirmedAt?: Date | string | null;
        confirmed_at?: Date | string | null;
        confirmedat?: Date | string | null;
        expiresAt?: Date | string | null;
        expires_at?: Date | string | null;
        expiresat?: Date | string | null;
      }
    | null
    | undefined,
) {
  if (!row) {
    return null;
  }

  return {
    chainId: Number(row.chainId ?? row.chain_id ?? row.chainid),
    walletAddress: row.walletAddress ?? row.wallet_address ?? row.walletaddress ?? "",
    reservationSessionToken:
      row.reservationSessionToken ?? row.reservation_session_token ?? row.reservationsessiontoken ?? null,
    status: row.status ?? "",
    confirmedAt: row.confirmedAt ?? row.confirmed_at ?? row.confirmedat ?? null,
    expiresAt: row.expiresAt ?? row.expires_at ?? row.expiresat ?? null,
  };
}

async function readQuotaSummary(params: {
  chainId: number;
  environment: string;
  raterIdentityKey: string;
  walletAddress: `0x${string}`;
}) {
  const identityKey = await ensureQuotaRow(db, params);
  const [row] = await db
    .select()
    .from(freeTransactionQuotas)
    .where(eq(freeTransactionQuotas.identityKey, identityKey))
    .limit(1);

  if (!row) {
    return null;
  }

  const quotaRow = normalizeQuotaRow(row);
  if (!quotaRow) {
    return null;
  }

  return buildQuotaSummary({
    chainId: quotaRow.chainId,
    environment: quotaRow.environment,
    freeTxLimit: quotaRow.freeTxLimit,
    freeTxUsed: quotaRow.freeTxUsed,
    raterIdentityKey: quotaRow.raterIdentityKey,
    walletAddress: params.walletAddress,
  });
}

export function __setFreeTransactionTestOverridesForTests(
  overrides: {
    resolveRaterIdentityKey?: ResolveRaterIdentityKey;
    getVerifiedThirdwebSmartAccountAdminAddresses?: GetVerifiedThirdwebSmartAccountAdminAddresses;
    allTransactionHashesSucceeded?: CheckTransactionHashesSucceeded;
    getTransactionVerificationClient?: GetTransactionVerificationClient;
  } | null,
) {
  freeTransactionTestOverrides = overrides;
}

function buildUnverifiedSummary(params: { chainId: number; walletAddress: `0x${string}` | null }) {
  const limit = getFreeTransactionLimit();

  return {
    chainId: params.chainId,
    environment: getServerEnvironmentScope(),
    limit,
    used: 0,
    remaining: 0,
    verified: false,
    exhausted: false,
    walletAddress: params.walletAddress,
    raterIdentityKey: null,
  } satisfies FreeTransactionAllowanceSummary;
}

function generateReservationSessionToken() {
  return randomBytes(FREE_TRANSACTION_RESERVATION_SESSION_TOKEN_BYTES).toString("hex");
}

function isReservationSessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function reservationSessionTokensMatch(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function buildAllowedDecision(params: {
  summary: FreeTransactionAllowanceSummary;
  reservationSessionToken?: string | null;
  debugCode?: string;
}): FreeTransactionAllowanceDecision {
  return {
    isAllowed: true,
    summary: params.summary,
    ...(params.reservationSessionToken ? { reservationSessionToken: params.reservationSessionToken } : {}),
    ...(params.debugCode ? { debugCode: params.debugCode } : {}),
  };
}

function buildIdentityBoundUnmeteredSummary(params: {
  chainId: number;
  raterIdentityKey: string;
  walletAddress: `0x${string}`;
}) {
  const limit = getFreeTransactionLimit();

  return {
    chainId: params.chainId,
    environment: getServerEnvironmentScope(),
    limit,
    used: 0,
    remaining: 0,
    verified: true,
    exhausted: false,
    walletAddress: params.walletAddress,
    raterIdentityKey: params.raterIdentityKey,
  } satisfies FreeTransactionAllowanceSummary;
}

function createFreeTransactionTimingLog(_params: {
  chainId?: number | null;
  operation: "evaluate_allowance" | "confirm_reservation";
  operationKey?: string | null;
  targetCount?: number | null;
  transactionHashCount?: number | null;
  walletAddress?: string | null;
}) {
  void _params;
  const emit = (_event: string, _extra: Record<string, unknown> = {}) => {
    void _event;
    void _extra;
  };

  return { emit };
}

type NormalizedVerifierCall = {
  data: Hex;
  to: `0x${string}`;
  value: Hex;
};

function normalizeCallValue(value: string | undefined): Hex | null {
  if (value === undefined) {
    return "0x0";
  }

  if (isHex(value)) {
    return toHex(BigInt(value));
  }

  if (/^\d+$/.test(value)) {
    return toHex(BigInt(value));
  }

  return null;
}

function extractOperationCalls(body: ThirdwebVerifierRequest): NormalizedVerifierCall[] | null {
  const targets = body.userOp?.data?.targets ?? body.userOp?.targets ?? [];
  const callDatas = body.userOp?.data?.callDatas;
  const values = body.userOp?.data?.values;

  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    !Array.isArray(callDatas) ||
    callDatas.length !== targets.length
  ) {
    return null;
  }

  if (values && values.length !== targets.length) {
    return null;
  }

  const calls: NormalizedVerifierCall[] = [];
  for (const [index, target] of targets.entries()) {
    const callData = callDatas[index];
    const value = normalizeCallValue(values?.[index]);

    if (!isAddress(target) || !isHex(callData) || !value) {
      return null;
    }

    calls.push({
      data: callData,
      to: normalizeAddress(target),
      value,
    });
  }

  return calls;
}

function extractOperationKey(body: ThirdwebVerifierRequest, calls: readonly NormalizedVerifierCall[]): Hash | null {
  const sender = body.userOp?.sender;
  if (!sender || !body.chainId || calls.length === 0) {
    return null;
  }

  return buildFreeTransactionOperationKey({
    chainId: body.chainId,
    calls,
    sender,
  });
}

function isZeroCallValue(value: Hex) {
  return BigInt(value) === 0n;
}

function normalizeAddressArg(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !isAddress(value)) {
    return null;
  }

  return normalizeAddress(value);
}

function normalizeUintArg(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  return null;
}

type SponsoredSubmissionQuestion = {
  contextUrl: string;
  detailsHash: string;
  detailsUrl: string;
  imageUrls: string[];
  tags: string;
  title: string;
  videoUrl: string;
};

type SponsoredSubmissionConfidentiality = {
  gated: boolean;
};

const MAX_FEEDBACK_TYPE_LENGTH = 32;
const MAX_FEEDBACK_BODY_LENGTH = 1600;
const MAX_FEEDBACK_SOURCE_URL_LENGTH = 2048;

function getTupleField(value: unknown, key: string, index: number) {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object") return (value as Record<string, unknown>)[key];
  return undefined;
}

function readStringField(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readStringArrayField(value: unknown) {
  return Array.isArray(value) && value.every(item => typeof item === "string") ? (value as string[]) : null;
}

function isBytes32Hex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function getUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function readSubmissionDetailsField(value: unknown): { detailsHash: string; detailsUrl: string } | null {
  const detailsUrl = readStringField(getTupleField(value, "detailsUrl", 0));
  const detailsHash = readStringField(getTupleField(value, "detailsHash", 1));
  if (detailsUrl === null || detailsHash === null) {
    return null;
  }

  return { detailsHash, detailsUrl };
}

function readSubmissionConfidentialityField(value: unknown): SponsoredSubmissionConfidentiality | null {
  const gated = getTupleField(value, "gated", 0);
  if (typeof gated !== "boolean") {
    return null;
  }

  return { gated };
}

function readSponsoredSubmissionQuestionFromArgs(args: readonly unknown[]): SponsoredSubmissionQuestion | null {
  const contextUrl = readStringField(args[0]);
  const imageUrls = readStringArrayField(args[1]);
  const videoUrl = readStringField(args[2]);
  const title = readStringField(args[3]);
  const tags = readStringField(args[4]);
  const details = readSubmissionDetailsField(args[6]);

  if (
    contextUrl === null ||
    imageUrls === null ||
    videoUrl === null ||
    title === null ||
    tags === null ||
    details === null
  ) {
    return null;
  }

  return {
    contextUrl,
    detailsHash: details.detailsHash,
    detailsUrl: details.detailsUrl,
    imageUrls,
    tags,
    title,
    videoUrl,
  };
}

function readSponsoredSubmissionQuestionFromTuple(value: unknown): SponsoredSubmissionQuestion | null {
  const contextUrl = readStringField(getTupleField(value, "contextUrl", 0));
  const imageUrls = readStringArrayField(getTupleField(value, "imageUrls", 1));
  const videoUrl = readStringField(getTupleField(value, "videoUrl", 2));
  const title = readStringField(getTupleField(value, "title", 3));
  const tags = readStringField(getTupleField(value, "tags", 4));
  const details = readSubmissionDetailsField(getTupleField(value, "details", 6));

  if (
    contextUrl === null ||
    imageUrls === null ||
    videoUrl === null ||
    title === null ||
    tags === null ||
    details === null
  ) {
    return null;
  }

  return {
    contextUrl,
    detailsHash: details.detailsHash,
    detailsUrl: details.detailsUrl,
    imageUrls,
    tags,
    title,
    videoUrl,
  };
}

function hasCanonicalContextUrl(value: string) {
  if (!value) return true;
  return normalizeSubmissionContextUrl(value) === value;
}

function hasCanonicalDetails(detailsUrl: string, detailsHash: string) {
  const hasDetailsUrl = Boolean(detailsUrl);
  const hasDetailsHash = detailsHash !== EMPTY_DETAILS_HASH;

  if (!/^0x[a-fA-F0-9]{64}$/.test(detailsHash)) return false;
  if (hasDetailsUrl !== hasDetailsHash) return false;
  if (!hasDetailsUrl) return true;
  return detailsUrl.trim() === detailsUrl && sanitizeExternalUrl(detailsUrl) === detailsUrl;
}

function hasCanonicalGatedDetails(detailsUrl: string, detailsHash: string) {
  return !detailsUrl && /^0x[a-fA-F0-9]{64}$/.test(detailsHash) && detailsHash !== EMPTY_DETAILS_HASH;
}

function hasCanonicalVideoUrl(value: string) {
  if (!value) return true;
  const normalized = normalizeSubmissionMediaUrl(value);
  return normalized === value && isYouTubeVideoUrl(normalized);
}

function hasCanonicalUploadedImageUrls(imageUrls: readonly string[]) {
  if (imageUrls.length > MAX_SUBMISSION_IMAGE_URLS) return false;

  return imageUrls.every((url, index) => {
    if (index > 0 && url <= imageUrls[index - 1]) return false;
    const normalized = normalizeSubmissionMediaUrl(url);
    return normalized === url && isUploadedImageUrl(normalized);
  });
}

async function validateSponsoredSubmissionQuestion(
  question: SponsoredSubmissionQuestion,
  walletAddress: `0x${string}`,
  gated = false,
) {
  const title = question.title.trim();
  const tags = question.tags.trim();

  if (!title || title !== question.title) return false;
  if (!tags || tags !== question.tags || tags.length > MAX_CONTENT_TAGS_LENGTH) return false;
  if (question.contextUrl.trim() !== question.contextUrl || question.videoUrl.trim() !== question.videoUrl)
    return false;
  if (gated) {
    if (question.contextUrl || question.imageUrls.length > 0 || question.videoUrl) return false;
    if (!hasCanonicalGatedDetails(question.detailsUrl, question.detailsHash)) return false;
  } else {
    if (!hasCanonicalContextUrl(question.contextUrl) || !hasCanonicalVideoUrl(question.videoUrl)) return false;
    if (!hasCanonicalDetails(question.detailsUrl, question.detailsHash)) return false;
    if (question.videoUrl && question.imageUrls.length > 0) return false;
    if (!question.contextUrl && question.imageUrls.length === 0 && !question.videoUrl) return false;
    if (!hasCanonicalUploadedImageUrls(question.imageUrls)) return false;
  }
  if (getContentTitleValidationError(title)) return false;

  const parsedTags = parseTags(tags);
  if (parsedTags.length === 0 || parsedTags.length > 3 || findBlockedContentTags(parsedTags).length > 0) {
    return false;
  }

  const imageValidationError = await getImageAttachmentSubmissionValidationError({
    imageUrls: question.imageUrls,
    ownerWalletAddress: walletAddress,
  });
  if (imageValidationError) return false;

  return true;
}

async function validateSponsoredContentRegistryCall(
  functionName: string,
  args: readonly unknown[],
  walletAddress: `0x${string}`,
) {
  if (functionName === "cancelReservedSubmission" || functionName === "reserveSubmission") {
    return true;
  }

  if (functionName === "submitQuestion" || functionName === "submitQuestionWithRewardAndRoundConfig") {
    const question = readSponsoredSubmissionQuestionFromArgs(args);
    const confidentiality =
      functionName === "submitQuestionWithRewardAndRoundConfig"
        ? readSubmissionConfidentialityField(args[11])
        : { gated: false };
    return question && confidentiality
      ? validateSponsoredSubmissionQuestion(question, walletAddress, confidentiality.gated)
      : false;
  }

  if (functionName === "submitQuestionBundleWithRewardAndRoundConfig") {
    const questions = args[0];
    if (!Array.isArray(questions) || questions.length === 0) return false;

    for (const value of questions) {
      const question = readSponsoredSubmissionQuestionFromTuple(value);
      if (!question || !(await validateSponsoredSubmissionQuestion(question, walletAddress, false))) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function validateSponsoredFeedbackRegistryCall(functionName: string, args: readonly unknown[]) {
  if (functionName !== "publishFeedback") return false;

  const contentId = normalizeUintArg(args[0]);
  const roundId = normalizeUintArg(args[1]);
  const commitKey = args[2];
  const feedbackType = readStringField(args[3]);
  const body = readStringField(args[4]);
  const sourceUrl = readStringField(args[5]);
  const clientNonce = args[6];

  if (
    contentId === null ||
    contentId <= 0n ||
    roundId === null ||
    roundId <= 0n ||
    !isBytes32Hex(commitKey) ||
    !isBytes32Hex(clientNonce) ||
    feedbackType === null ||
    body === null ||
    sourceUrl === null
  ) {
    return false;
  }

  if (
    feedbackType.trim() !== feedbackType ||
    !feedbackType ||
    getUtf8ByteLength(feedbackType) > MAX_FEEDBACK_TYPE_LENGTH
  ) {
    return false;
  }
  if (body.trim() !== body || !body || getUtf8ByteLength(body) > MAX_FEEDBACK_BODY_LENGTH) return false;
  if (sourceUrl.trim() !== sourceUrl || getUtf8ByteLength(sourceUrl) > MAX_FEEDBACK_SOURCE_URL_LENGTH) return false;
  return !sourceUrl || sanitizeExternalUrl(sourceUrl) === sourceUrl;
}

function validateEip3009Authorization(params: {
  amountArgIndex: number;
  args: readonly unknown[];
  expectedPayee: Address;
  walletAddress: `0x${string}`;
}) {
  const paymentParams = params.args[0];
  const authorization = params.args[1];
  const expectedAmount = normalizeUintArg(getTupleField(paymentParams, "amount", params.amountArgIndex));
  const from = normalizeAddressArg(getTupleField(authorization, "from", 0));
  const to = normalizeAddressArg(getTupleField(authorization, "to", 1));
  const value = normalizeUintArg(getTupleField(authorization, "value", 2));
  const validAfter = normalizeUintArg(getTupleField(authorization, "validAfter", 3));
  const validBefore = normalizeUintArg(getTupleField(authorization, "validBefore", 4));
  const nonce = getTupleField(authorization, "nonce", 5);
  const v = normalizeUintArg(getTupleField(authorization, "v", 6));
  const r = getTupleField(authorization, "r", 7);
  const s = getTupleField(authorization, "s", 8);

  if (
    expectedAmount === null ||
    expectedAmount <= 0n ||
    from?.toLowerCase() !== params.walletAddress.toLowerCase() ||
    to?.toLowerCase() !== params.expectedPayee.toLowerCase() ||
    value === null ||
    value !== expectedAmount ||
    validAfter === null ||
    validBefore === null ||
    validBefore <= validAfter ||
    validBefore <= BigInt(Math.floor(Date.now() / 1000)) ||
    !isBytes32Hex(nonce) ||
    !isBytes32Hex(r) ||
    !isBytes32Hex(s) ||
    v === null ||
    v > 255n
  ) {
    return false;
  }

  return true;
}

async function validateSponsoredX402QuestionSubmitterCall(
  functionName: string,
  args: readonly unknown[],
  submitterAddress: Address,
  walletAddress: `0x${string}`,
) {
  if (functionName !== "submitQuestionWithX402Payment" && functionName !== "submitQuestionWithX402OneShotPayment") {
    return false;
  }

  const question = readSponsoredSubmissionQuestionFromArgs(args);
  if (!question) return false;

  const confidentiality = readSubmissionConfidentialityField(args[11]);
  if (!(await validateSponsoredSubmissionQuestion(question, walletAddress, confidentiality?.gated ?? false))) {
    return false;
  }

  const paymentAuthorization = args[args.length - 1];
  return validateEip3009Authorization({
    amountArgIndex: 1,
    args: [{ amount: normalizeUintArg(getTupleField(paymentAuthorization, "value", 2)) }, paymentAuthorization],
    expectedPayee: submitterAddress,
    walletAddress,
  });
}

async function validateSponsoredCalls(
  chainId: number,
  calls: readonly NormalizedVerifierCall[],
  walletAddress: `0x${string}`,
): Promise<{ ok: true } | { ok: false; debugCode: "target_not_allowlisted" | "unsupported_operation" }> {
  const contracts = getContractsForChain(chainId);
  const contractsByAddress = getContractsByAddress(chainId);
  const frontendRegistry = contracts?.FrontendRegistry;
  const rewardEscrow = contracts?.QuestionRewardPoolEscrow;
  const feedbackBonusEscrow = contracts?.FeedbackBonusEscrow;
  const confidentialityEscrow = contracts?.ConfidentialityEscrow;
  const votingEngine = contracts?.RoundVotingEngine;
  const x402QuestionSubmitter = contracts?.X402QuestionSubmitter;
  const allowedApproveSpenders = new Set(
    [
      frontendRegistry?.address,
      rewardEscrow?.address,
      feedbackBonusEscrow?.address,
      confidentialityEscrow?.address,
      votingEngine?.address,
    ]
      .filter((value): value is Address => Boolean(value))
      .map(value => value.toLowerCase()),
  );

  for (const call of calls) {
    if (!isZeroCallValue(call.value)) {
      return { ok: false, debugCode: "unsupported_operation" };
    }

    const contract = contractsByAddress.get(call.to.toLowerCase()) ?? getKnownUsdcContractForCall(chainId, call.to);
    if (!contract) {
      return { ok: false, debugCode: "target_not_allowlisted" };
    }

    let decoded: { functionName: string; args: readonly unknown[] | undefined };
    try {
      decoded = decodeFunctionData({
        abi: contract.abi,
        data: call.data,
      }) as { functionName: string; args: readonly unknown[] | undefined };
    } catch {
      if (contract.name === "ContentRegistry") {
        try {
          decoded = decodeContentRegistryCallData(call.data);
        } catch {
          return { ok: false, debugCode: "unsupported_operation" };
        }
      } else {
        return { ok: false, debugCode: "unsupported_operation" };
      }
    }

    const args = decoded.args ?? [];
    const functionName = decoded.functionName;
    if (functionName === "approve") {
      const spender = normalizeAddressArg(args[0]);
      if (
        ALLOWED_APPROVE_TOKEN_NAMES.has(contract.name) &&
        spender &&
        allowedApproveSpenders.has(spender.toLowerCase())
      ) {
        continue;
      }
    }

    switch (contract.name) {
      case "LoopReputation":
        return { ok: false, debugCode: "unsupported_operation" };
      case "ContentRegistry":
        if (await validateSponsoredContentRegistryCall(functionName, args, walletAddress)) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "FrontendRegistry":
        if (
          functionName === "register" ||
          functionName === "requestDeregister" ||
          functionName === "completeDeregister" ||
          functionName === "requestFeeWithdrawal" ||
          functionName === "completeFeeWithdrawal" ||
          functionName === "setSnapshotProposer" ||
          functionName === "clearSnapshotProposer"
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "ProfileRegistry":
        if (
          functionName === "setProfile" ||
          functionName === "setAvatarAccent" ||
          functionName === "clearAvatarAccent"
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "RaterRegistry":
        if (
          functionName === "setProfile" ||
          functionName === "setDelegate" ||
          functionName === "removeDelegate" ||
          functionName === "acceptDelegateWithSig" ||
          functionName === "followProfile" ||
          functionName === "unfollowProfile"
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "RoundVotingEngine":
        if (
          functionName === "claimCancelledRoundRefund" ||
          functionName === "commitVote" ||
          functionName === "commitVoteWithPermit" ||
          functionName === "openRound"
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "AdvisoryVoteRecorder":
        if (functionName === "recordAdvisoryVote") {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "FeedbackRegistry":
        if (validateSponsoredFeedbackRegistryCall(functionName, args)) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "ConfidentialityEscrow":
        if (functionName === "postBond") {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "RoundRewardDistributor":
        if (functionName === "claimFrontendFee" || functionName === "claimReward") {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "QuestionRewardPoolEscrow":
        if (
          functionName === "claimQuestionReward" ||
          functionName === "claimQuestionBundleReward" ||
          functionName === "createRewardPool"
        ) {
          continue;
        }
        if (
          functionName === "createRewardPoolWithAuthorization" &&
          rewardEscrow &&
          validateEip3009Authorization({
            amountArgIndex: 1,
            args,
            expectedPayee: rewardEscrow.address,
            walletAddress,
          })
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "FeedbackBonusEscrow":
        if (functionName === "createFeedbackBonusPoolWithAsset" || functionName === "awardFeedbackBonus") {
          continue;
        }
        if (
          functionName === "createFeedbackBonusPoolWithAuthorization" &&
          feedbackBonusEscrow &&
          validateEip3009Authorization({
            amountArgIndex: 2,
            args,
            expectedPayee: feedbackBonusEscrow.address,
            walletAddress,
          })
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "X402QuestionSubmitter":
        if (
          x402QuestionSubmitter &&
          (await validateSponsoredX402QuestionSubmitterCall(
            functionName,
            args,
            x402QuestionSubmitter.address,
            walletAddress,
          ))
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "LaunchDistributionPool":
        if (
          functionName === "claimLegacyContributorAllocation" ||
          functionName === "claimLegacyContributorAllocationTo"
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      default:
        return { ok: false, debugCode: "target_not_allowlisted" };
    }
  }

  return { ok: true };
}

function isUnmeteredFrontendRegistrationOperation(chainId: number, calls: readonly NormalizedVerifierCall[]) {
  if (calls.length !== 2 || !calls.every(call => isZeroCallValue(call.value))) {
    return false;
  }

  const contracts = getContractsForChain(chainId);
  const frontendRegistry = contracts?.FrontendRegistry;
  if (!frontendRegistry) {
    return false;
  }

  const contractsByAddress = getContractsByAddress(chainId);
  const approvalContract =
    contractsByAddress.get(calls[0].to.toLowerCase()) ?? getKnownUsdcContractForCall(chainId, calls[0].to);
  const registerContract = contractsByAddress.get(calls[1].to.toLowerCase());
  if (
    !approvalContract ||
    !registerContract ||
    !ALLOWED_APPROVE_TOKEN_NAMES.has(approvalContract.name) ||
    registerContract.name !== "FrontendRegistry"
  ) {
    return false;
  }

  try {
    const approval = decodeFunctionData({
      abi: approvalContract.abi,
      data: calls[0].data,
    }) as { functionName: string; args: readonly unknown[] | undefined };
    const registration = decodeFunctionData({
      abi: registerContract.abi,
      data: calls[1].data,
    }) as { functionName: string; args: readonly unknown[] | undefined };
    const spender = normalizeAddressArg(approval.args?.[0]);
    const amount = normalizeUintArg(approval.args?.[1]);

    return (
      approval.functionName === "approve" &&
      spender?.toLowerCase() === frontendRegistry.address.toLowerCase() &&
      amount === FRONTEND_REGISTRATION_STAKE_AMOUNT &&
      registration.functionName === "register" &&
      (registration.args?.length ?? 0) === 0
    );
  } catch {
    return false;
  }
}

function logsIncludeWalletUserOperationSender(params: {
  logs: readonly TransactionVerificationLog[];
  walletAddress: `0x${string}`;
}) {
  const normalizedWalletAddress = params.walletAddress.toLowerCase();

  return parseEventLogs({
    abi: USER_OPERATION_RECEIPT_EVENT_ABI,
    logs: normalizeReceiptLogsForEventParsing(params.logs),
    strict: false,
  }).some(event => {
    const sender = event.args.sender;
    return typeof sender === "string" && sender.toLowerCase() === normalizedWalletAddress;
  });
}

function logsIncludeWalletExecutedEvent(params: {
  logs: readonly TransactionVerificationLog[];
  walletAddress: `0x${string}`;
}) {
  const normalizedWalletAddress = params.walletAddress.toLowerCase();

  return parseEventLogs({
    abi: EXECUTED_RECEIPT_EVENT_ABI,
    logs: normalizeReceiptLogsForEventParsing(params.logs),
    strict: false,
  }).some(event => {
    const user = event.args.user;
    return typeof user === "string" && user.toLowerCase() === normalizedWalletAddress;
  });
}

function logsIncludeWalletExecutionProof(params: {
  logs: readonly TransactionVerificationLog[];
  walletAddress: `0x${string}`;
}) {
  return logsIncludeWalletUserOperationSender(params) || logsIncludeWalletExecutedEvent(params);
}

function normalizeReceiptLogsForEventParsing(logs: readonly TransactionVerificationLog[]) {
  return logs.map(log => ({
    ...log,
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    removed: false,
    topics: [...log.topics],
    transactionHash: null,
    transactionIndex: null,
  })) as Parameters<typeof parseEventLogs>[0]["logs"];
}

async function allTransactionHashesSucceeded(params: {
  chainId: number;
  transactionHashes: Hash[];
  walletAddress: `0x${string}`;
}) {
  const client = await getTransactionVerificationClient(params.chainId);
  if (!client || params.transactionHashes.length === 0) {
    return false;
  }

  const receipts = await Promise.all(
    params.transactionHashes.map(async hash => {
      try {
        const [receipt, transaction] = await Promise.all([
          client.getTransactionReceipt({ hash }),
          client.getTransaction({ hash }),
        ]);

        return {
          ok: receipt.status === "success" && Number(transaction.chainId) === params.chainId,
          from: transaction.from.toLowerCase(),
          matchesWallet:
            transaction.from.toLowerCase() === params.walletAddress.toLowerCase() ||
            logsIncludeWalletExecutionProof({
              logs: receipt.logs,
              walletAddress: params.walletAddress,
            }),
        };
      } catch {
        return { matchesWallet: false, ok: false };
      }
    }),
  );

  const hasWalletMismatch = receipts.some(receipt => receipt.ok && !receipt.matchesWallet);
  if (hasWalletMismatch) {
    console.warn("[thirdweb-free-tx] rejected sponsored transaction without wallet execution proof", {
      chainId: params.chainId,
      transactionHashes: params.transactionHashes,
      walletAddress: params.walletAddress,
    });
    return false;
  }

  return receipts.every(receipt => receipt.ok && receipt.matchesWallet);
}

export function readReservationSessionTokenFromAllowance(decision: FreeTransactionAllowanceDecision): string | null {
  if (!decision.isAllowed) {
    return null;
  }

  return decision.reservationSessionToken ?? null;
}

export async function ensureFreeTransactionQuotaTable() {
  if (!ensureFreeTransactionQuotaTablePromise) {
    ensureFreeTransactionQuotaTablePromise = Promise.resolve();
  }

  await ensureFreeTransactionQuotaTablePromise;
}

export async function getFreeTransactionAllowanceSummary(params: { address: string; chainId: number }) {
  await ensureFreeTransactionQuotaTable();

  if (!isAddress(params.address)) {
    throw new Error("Invalid address");
  }

  const walletAddress = normalizeAddress(params.address);
  const raterIdentityKey = await resolveFreeTransactionRaterIdentityKey({
    chainId: params.chainId,
    walletAddress,
  });

  if (!raterIdentityKey) {
    return buildUnverifiedSummary({
      chainId: params.chainId,
      walletAddress,
    });
  }

  try {
    const summary = await readQuotaSummary({
      chainId: params.chainId,
      environment: getServerEnvironmentScope(),
      raterIdentityKey,
      walletAddress,
    });

    if (!summary) {
      throw new Error("Failed to read free transaction quota summary.");
    }

    return summary;
  } catch (error) {
    if (isFreeTransactionStoreUnavailableError(error)) {
      console.warn("[thirdweb-free-tx] quota store unavailable during summary lookup; using self-funded fallback.", {
        address: walletAddress,
        chainId: params.chainId,
        raterIdentityKey,
      });
    }

    throw error;
  }
}

export async function evaluateFreeTransactionAllowance(
  body: ThirdwebVerifierRequest,
): Promise<FreeTransactionAllowanceDecision> {
  const requestedTargets = body.userOp?.data?.targets ?? body.userOp?.targets;
  const timingLog = createFreeTransactionTimingLog({
    chainId: typeof body.chainId === "number" ? body.chainId : null,
    operation: "evaluate_allowance",
    targetCount: Array.isArray(requestedTargets) ? requestedTargets.length : null,
  });
  const finish = <Decision extends FreeTransactionAllowanceDecision>(
    decision: Decision,
    extra: Record<string, unknown> = {},
  ) => {
    const summary = "summary" in decision ? decision.summary : undefined;
    timingLog.emit("decision", {
      ...extra,
      debugCode: decision.debugCode ?? null,
      exhausted: summary?.exhausted ?? null,
      isAllowed: decision.isAllowed,
      reason: decision.isAllowed ? null : decision.reason,
      remaining: summary?.remaining ?? null,
      used: summary?.used ?? null,
      verified: summary?.verified ?? null,
    });
    return decision;
  };

  await ensureFreeTransactionQuotaTable();
  timingLog.emit("quota-table-ready");

  if (typeof body.chainId !== "number") {
    return finish({
      debugCode: "invalid_chain",
      isAllowed: false,
      reason: DEFAULT_DENY_REASON,
    });
  }
  const chainId = body.chainId;

  const sender = body.userOp?.sender;
  if (!sender || !isAddress(sender)) {
    return finish({
      debugCode: "invalid_sender",
      isAllowed: false,
      reason: DEFAULT_DENY_REASON,
    });
  }

  const calls = extractOperationCalls(body);
  if (!calls || calls.length === 0) {
    return finish({
      debugCode: "invalid_targets",
      isAllowed: false,
      reason: DEFAULT_DENY_REASON,
    });
  }
  timingLog.emit("calls-extracted", {
    targetCount: calls.length,
  });

  const walletAddress = normalizeAddress(sender);
  const validatedCalls = await validateSponsoredCalls(chainId, calls, walletAddress);
  if (!validatedCalls.ok) {
    return finish(
      {
        debugCode: validatedCalls.debugCode,
        isAllowed: false,
        reason: DEFAULT_DENY_REASON,
      },
      { walletAddress },
    );
  }
  timingLog.emit("calls-validated", {
    targetCount: calls.length,
    walletAddress,
  });

  const raterIdentityKey = await resolveFreeTransactionRaterIdentityKey({
    chainId,
    userOp: body.userOp,
    walletAddress,
  });
  timingLog.emit("identity-resolved", {
    hasRaterIdentity: Boolean(raterIdentityKey),
    walletAddress,
  });

  if (!raterIdentityKey) {
    return finish(
      {
        debugCode: "missing_rater_identity",
        isAllowed: false,
        reason: NO_RATER_IDENTITY_REASON,
        summary: buildUnverifiedSummary({
          chainId,
          walletAddress,
        }),
      },
      { walletAddress },
    );
  }

  if (isUnmeteredFrontendRegistrationOperation(chainId, calls)) {
    timingLog.emit("unmetered-operation", {
      debugCode: "frontend_registration",
      walletAddress,
    });
    return finish(
      {
        debugCode: "frontend_registration",
        isAllowed: true,
        summary: buildIdentityBoundUnmeteredSummary({
          chainId,
          raterIdentityKey,
          walletAddress,
        }),
      },
      { walletAddress },
    );
  }

  const operationKey = extractOperationKey(body, calls);
  if (!operationKey) {
    return finish(
      {
        debugCode: "invalid_operation_key",
        isAllowed: false,
        reason: DEFAULT_DENY_REASON,
      },
      { walletAddress },
    );
  }
  timingLog.emit("operation-key-derived", {
    operationKey,
    walletAddress,
  });

  const environment = getServerEnvironmentScope();

  try {
    timingLog.emit("quota-transaction-start", {
      operationKey,
      walletAddress,
    });
    const decision = await db.transaction(async (tx): Promise<FreeTransactionAllowanceDecision> => {
      const identityKey = await ensureQuotaRow(tx, {
        chainId,
        environment,
        raterIdentityKey,
        walletAddress,
      });
      const now = new Date();
      const expiresAt = new Date(now.getTime() + FREE_TRANSACTION_RESERVATION_TTL_MS);
      const [quotaRow] = await tx
        .select()
        .from(freeTransactionQuotas)
        .where(eq(freeTransactionQuotas.identityKey, identityKey))
        .limit(1)
        .for("update");

      const normalizedQuotaRow = normalizeQuotaRow(quotaRow);
      if (!normalizedQuotaRow) {
        throw new Error("Failed to read free transaction quota.");
      }
      timingLog.emit("quota-row-read", {
        freeTxLimit: normalizedQuotaRow.freeTxLimit,
        freeTxUsed: normalizedQuotaRow.freeTxUsed,
        operationKey,
        walletAddress,
      });

      const [existingReservation] = await tx
        .select()
        .from(freeTransactionReservations)
        .where(eq(freeTransactionReservations.operationKey, operationKey))
        .limit(1);
      const normalizedReservation = normalizeReservationRow(existingReservation);

      const idempotentConfirmed =
        normalizedReservation?.status === "confirmed" &&
        normalizedReservation.confirmedAt &&
        now.getTime() - getTimestampMs(normalizedReservation.confirmedAt) <= FREE_TRANSACTION_IDEMPOTENCY_WINDOW_MS;

      if (
        normalizedReservation?.status === "pending" &&
        normalizedReservation.expiresAt &&
        getTimestampMs(normalizedReservation.expiresAt) > now.getTime()
      ) {
        let reservationSessionToken = normalizedReservation.reservationSessionToken;
        if (!isReservationSessionToken(reservationSessionToken)) {
          reservationSessionToken = generateReservationSessionToken();
          await tx
            .update(freeTransactionReservations)
            .set({
              reservationSessionToken,
              updatedAt: now,
            })
            .where(eq(freeTransactionReservations.operationKey, operationKey));
        }

        timingLog.emit("reservation-reused", {
          operationKey,
          reservationStatus: "pending",
          walletAddress,
        });
        return buildAllowedDecision({
          summary: buildQuotaSummary({
            chainId: normalizedQuotaRow.chainId,
            environment: normalizedQuotaRow.environment,
            freeTxLimit: normalizedQuotaRow.freeTxLimit,
            freeTxUsed: normalizedQuotaRow.freeTxUsed,
            raterIdentityKey: normalizedQuotaRow.raterIdentityKey,
            walletAddress,
          }),
          reservationSessionToken,
        });
      }

      if (idempotentConfirmed) {
        timingLog.emit("reservation-reused", {
          operationKey,
          reservationStatus: "confirmed",
          walletAddress,
        });
        return {
          isAllowed: true,
          summary: buildQuotaSummary({
            chainId: normalizedQuotaRow.chainId,
            environment: normalizedQuotaRow.environment,
            freeTxLimit: normalizedQuotaRow.freeTxLimit,
            freeTxUsed: normalizedQuotaRow.freeTxUsed,
            raterIdentityKey: normalizedQuotaRow.raterIdentityKey,
            walletAddress,
          }),
        };
      }

      if (normalizedQuotaRow.freeTxUsed >= normalizedQuotaRow.freeTxLimit) {
        timingLog.emit("quota-exhausted", {
          freeTxLimit: normalizedQuotaRow.freeTxLimit,
          freeTxUsed: normalizedQuotaRow.freeTxUsed,
          operationKey,
          walletAddress,
        });
        const [latestQuotaRow] = await tx
          .select()
          .from(freeTransactionQuotas)
          .where(eq(freeTransactionQuotas.identityKey, identityKey))
          .limit(1);

        const normalizedLatestQuotaRow = normalizeQuotaRow(latestQuotaRow);
        if (!normalizedLatestQuotaRow) {
          throw new Error("Failed to read free transaction quota.");
        }

        return {
          isAllowed: false,
          debugCode: "free_tx_exhausted",
          reason: FREE_TX_EXHAUSTED_REASON,
          summary: buildQuotaSummary({
            chainId: normalizedLatestQuotaRow.chainId,
            environment: normalizedLatestQuotaRow.environment,
            freeTxLimit: normalizedLatestQuotaRow.freeTxLimit,
            freeTxUsed: normalizedLatestQuotaRow.freeTxUsed,
            raterIdentityKey: normalizedLatestQuotaRow.raterIdentityKey,
            walletAddress,
          }),
        };
      }

      const reservationSessionToken = generateReservationSessionToken();

      if (existingReservation) {
        await tx
          .update(freeTransactionReservations)
          .set({
            identityKey,
            raterIdentityKey,
            chainId,
            environment,
            walletAddress,
            reservationSessionToken,
            status: "pending",
            txHashes: null,
            reservedAt: now,
            expiresAt,
            confirmedAt: null,
            releasedAt: null,
            updatedAt: now,
          })
          .where(eq(freeTransactionReservations.operationKey, operationKey));
      } else {
        await tx.insert(freeTransactionReservations).values({
          operationKey,
          identityKey,
          raterIdentityKey,
          chainId,
          environment,
          walletAddress,
          reservationSessionToken,
          status: "pending",
          txHashes: null,
          reservedAt: now,
          expiresAt,
          confirmedAt: null,
          releasedAt: null,
          updatedAt: now,
        });
      }

      const [updatedQuotaRow] = await tx
        .update(freeTransactionQuotas)
        .set({
          lastWalletAddress: walletAddress,
          freeTxUsed: sql`${freeTransactionQuotas.freeTxUsed} + 1`,
          exhaustedAt: sql`
            CASE
              WHEN ${freeTransactionQuotas.freeTxUsed} + 1 >= ${freeTransactionQuotas.freeTxLimit}
              THEN ${now}
              ELSE ${freeTransactionQuotas.exhaustedAt}
            END
          `,
          updatedAt: now,
        })
        .where(eq(freeTransactionQuotas.identityKey, identityKey))
        .returning();
      const normalizedUpdatedQuotaRow = normalizeQuotaRow(updatedQuotaRow);
      if (!normalizedUpdatedQuotaRow) {
        throw new Error("Failed to update free transaction quota.");
      }
      timingLog.emit("reservation-created", {
        freeTxLimit: normalizedUpdatedQuotaRow.freeTxLimit,
        freeTxUsed: normalizedUpdatedQuotaRow.freeTxUsed,
        operationKey,
        walletAddress,
      });

      return buildAllowedDecision({
        summary: buildQuotaSummary({
          chainId: normalizedUpdatedQuotaRow.chainId,
          environment: normalizedUpdatedQuotaRow.environment,
          freeTxLimit: normalizedUpdatedQuotaRow.freeTxLimit,
          freeTxUsed: normalizedUpdatedQuotaRow.freeTxUsed,
          raterIdentityKey: normalizedUpdatedQuotaRow.raterIdentityKey,
          walletAddress,
        }),
        reservationSessionToken,
      });
    });
    timingLog.emit("quota-transaction-complete", {
      operationKey,
      walletAddress,
    });
    return finish(decision, {
      operationKey,
      walletAddress,
    });
  } catch (error) {
    if (isFreeTransactionStoreUnavailableError(error)) {
      console.warn("[thirdweb-free-tx] quota store unavailable during verifier check; failing closed.", {
        chainId,
        sender: walletAddress,
        raterIdentityKey,
      });
      return finish(
        {
          debugCode: "quota_store_unavailable",
          isAllowed: false,
          reason: DEFAULT_DENY_REASON,
        },
        {
          operationKey,
          walletAddress,
        },
      );
    }

    timingLog.emit("failure", {
      message: error instanceof Error ? error.message : "Unknown error",
      operationKey,
      walletAddress,
    });
    throw error;
  }
}

export async function confirmFreeTransactionReservation(params: {
  address: string;
  chainId: number;
  operationKey: string;
  reservationSessionToken: string;
  transactionHashes: string[];
}): Promise<FreeTransactionConfirmationResult> {
  const timingLog = createFreeTransactionTimingLog({
    chainId: Number.isFinite(params.chainId) ? params.chainId : null,
    operation: "confirm_reservation",
    operationKey: isHash(params.operationKey) ? params.operationKey : null,
    transactionHashCount: params.transactionHashes.length,
    walletAddress: isAddress(params.address) ? normalizeAddress(params.address) : null,
  });

  if (
    !isAddress(params.address) ||
    !Number.isFinite(params.chainId) ||
    !isHash(params.operationKey) ||
    !isReservationSessionToken(params.reservationSessionToken)
  ) {
    timingLog.emit("failure", {
      reason: "invalid_confirmation_payload",
    });
    throw new Error("Invalid free transaction confirmation payload");
  }

  const normalizedTransactionHashes = [...new Set(params.transactionHashes.filter(isHash))] as Hash[];
  if (normalizedTransactionHashes.length === 0) {
    timingLog.emit("failure", {
      reason: "missing_transaction_hashes",
    });
    throw new Error("At least one transaction hash is required");
  }
  timingLog.emit("transaction-hashes-normalized", {
    transactionHashCount: normalizedTransactionHashes.length,
  });

  const walletAddress = normalizeAddress(params.address);
  timingLog.emit("receipt-verification-start", {
    operationKey: params.operationKey,
    transactionHashCount: normalizedTransactionHashes.length,
    walletAddress,
  });
  const allSucceeded = await (
    freeTransactionTestOverrides?.allTransactionHashesSucceeded ?? allTransactionHashesSucceeded
  )({
    chainId: params.chainId,
    transactionHashes: normalizedTransactionHashes,
    walletAddress,
  });
  timingLog.emit("receipt-verification-complete", {
    allSucceeded,
    operationKey: params.operationKey,
    transactionHashCount: normalizedTransactionHashes.length,
    walletAddress,
  });

  if (!allSucceeded) {
    timingLog.emit("failure", {
      reason: "receipt_verification_failed",
      operationKey: params.operationKey,
      transactionHashCount: normalizedTransactionHashes.length,
      walletAddress,
    });
    throw new Error("Sponsored transaction receipts could not be verified");
  }

  try {
    await ensureFreeTransactionQuotaTable();
    timingLog.emit("quota-table-ready", {
      operationKey: params.operationKey,
      walletAddress,
    });

    timingLog.emit("confirmation-transaction-start", {
      operationKey: params.operationKey,
      walletAddress,
    });
    const confirmationOutcome = await db.transaction(async (tx): Promise<FreeTransactionConfirmationOutcome> => {
      const [reservation] = await tx
        .select()
        .from(freeTransactionReservations)
        .where(eq(freeTransactionReservations.operationKey, params.operationKey as Hash))
        .limit(1);
      const normalizedReservation = normalizeReservationRow(reservation);

      if (!normalizedReservation) {
        return "missing_reservation";
      }

      if (
        normalizedReservation.chainId !== params.chainId ||
        normalizedReservation.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
      ) {
        return "reservation_mismatch";
      }

      const storedSessionToken = normalizedReservation.reservationSessionToken;
      if (
        !isReservationSessionToken(storedSessionToken) ||
        !reservationSessionTokensMatch(storedSessionToken, params.reservationSessionToken)
      ) {
        return "reservation_mismatch";
      }

      if (normalizedReservation.status === "confirmed") {
        return "already_confirmed";
      }

      if (normalizedReservation.status !== "pending") {
        return `ignored_${normalizedReservation.status || "unknown"}`;
      }

      const now = new Date();
      const updatedReservations = await tx
        .update(freeTransactionReservations)
        .set({
          status: "confirmed",
          txHashes: JSON.stringify(normalizedTransactionHashes),
          confirmedAt: now,
          releasedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(freeTransactionReservations.operationKey, params.operationKey as Hash),
            eq(freeTransactionReservations.status, "pending"),
          ),
        )
        .returning({ operationKey: freeTransactionReservations.operationKey });

      if (updatedReservations.length === 0) {
        return "update_skipped";
      }
      return "confirmed";
    });
    timingLog.emit("confirmation-transaction-complete", {
      confirmationOutcome,
      operationKey: params.operationKey,
      walletAddress,
    });
    timingLog.emit("success", {
      confirmationOutcome,
      operationKey: params.operationKey,
      walletAddress,
    });
    return {
      confirmed: confirmationOutcome === "confirmed" || confirmationOutcome === "already_confirmed",
      outcome: confirmationOutcome,
    };
  } catch (error) {
    if (isFreeTransactionStoreUnavailableError(error)) {
      console.warn("[thirdweb-free-tx] quota store unavailable during confirmation; failing closed.", {
        address: walletAddress,
        chainId: params.chainId,
        operationKey: params.operationKey,
      });
      timingLog.emit("failure", {
        debugCode: "quota_store_unavailable",
        operationKey: params.operationKey,
        walletAddress,
      });
      throw error;
    }

    timingLog.emit("failure", {
      message: error instanceof Error ? error.message : "Unknown error",
      operationKey: params.operationKey,
      walletAddress,
    });
    throw error;
  }
}
