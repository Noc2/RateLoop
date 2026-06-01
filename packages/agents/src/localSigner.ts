import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import type {
  AskHumansRequest,
  AskHumansResponse,
  ConfirmAskTransactionsRequest,
  RateLoopAgentClient,
  RateLoopAgentWalletTransactionCall,
  QuestionStatusResponse,
} from "@rateloop/sdk/agent";

type CliOptions = Record<string, string | boolean | undefined>;
type JsonRecord = Record<string, unknown>;

const KEYSTORE_VERSION = 3;
const DEFAULT_SCRYPT_PARAMS = {
  dklen: 32,
  n: 1 << 15,
  p: 1,
  r: 8,
};
const X402_USDC_BY_CHAIN_ID: Record<number, Address> = {
  480: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  4801: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
};
const X402_PRIMARY_TYPE = "ReceiveWithAuthorization";
const X402_AUTHORIZATION_FIELDS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

type LocalSignerConfig = {
  chainId?: number;
  chainName: string;
  keystorePassword?: string;
  keystorePath?: string;
  pollingIntervalMs: number;
  privateKey?: Hex;
  receiptTimeoutMs: number;
  rpcUrl?: string;
  usdcAddress?: Address;
  x402QuestionSubmitterAddress?: Address;
};

type LoadedLocalSignerWallet = {
  account: PrivateKeyAccount;
  source: "keystore" | "private-key";
};

type GeneratedLocalSignerWallet = LoadedLocalSignerWallet & {
  keystorePath: string;
};

export type LocalTransactionReceiptSummary = {
  blockNumber: string;
  gasUsed: string;
  status: TransactionReceipt["status"];
  transactionHash: Hex;
};

type LocalTransactionExecutionSummary = {
  calls: Array<{
    hash: Hex;
    index: number;
    phase?: string;
    receipt: LocalTransactionReceiptSummary;
    to: Address;
  }>;
  transactionHashes: Hex[];
};

type LocalAskResult = {
  confirmed?: QuestionStatusResponse;
  finalAsk: AskHumansResponse;
  initialAsk: AskHumansResponse;
  signedX402Authorization: boolean;
  transactions?: LocalTransactionExecutionSummary;
  walletAddress: Address;
};

export type LocalAskProgress =
  | { type: "ask_submitted"; response: AskHumansResponse }
  | { type: "x402_signed" }
  | { type: "x402_resubmitted"; response: AskHumansResponse }
  | { type: "transaction_sent"; hash: Hex; index: number; phase?: string }
  | { type: "transaction_confirmed"; hash: Hex; index: number; receipt: LocalTransactionReceiptSummary }
  | { type: "transactions_confirmed"; response: QuestionStatusResponse };

type KeystoreV3 = {
  address?: string;
  crypto: {
    cipher: "aes-128-ctr";
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: "scrypt";
    kdfparams: {
      dklen: number;
      n: number;
      p: number;
      r: number;
      salt: string;
    };
    mac: string;
  };
  id?: string;
  version: 3;
};

type TypedDataField = {
  name: string;
  type: string;
};

type X402TypedData = {
  domain: JsonRecord;
  message: JsonRecord;
  primaryType: string;
  types: Record<string, TypedDataField[]>;
};

type X402Authorization = {
  from?: Address;
  nonce?: Hex;
  signature?: Hex;
  to?: Address;
  validAfter?: string;
  validBefore?: string;
  value?: string;
};

type SignX402AuthorizationOptions = {
  expectedAmount?: bigint | number | string;
  expectedChainId?: number;
  expectedUsdcAddress?: Address;
  expectedX402QuestionSubmitterAddress?: Address;
};

function optionString(options: CliOptions, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function envString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function parsePrivateKey(value: string | undefined, name: string): Hex | undefined {
  if (!value) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex private key.`);
  }
  return value as Hex;
}

function parseOptionalAddress(value: string | undefined, name: string): Address | undefined {
  if (!value) return undefined;
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} must be an EVM address.`);
  }
  return value as Address;
}

function assertRecord(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as JsonRecord;
}

function normalizeAddress(value: unknown, name: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${name} must be an EVM address.`);
  }
  return value as Address;
}

function normalizeHex(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !isHex(value)) {
    throw new Error(`${name} must be hex.`);
  }
  return value as Hex;
}

function normalizeBytes32(value: unknown, name: string): Hex {
  const hex = normalizeHex(value, name);
  if (hex.length !== 66) {
    throw new Error(`${name} must be 32 bytes.`);
  }
  return hex;
}

function normalizeOptionalTransactionData(value: unknown, name: string): Hex {
  if (value === undefined || value === null || value === "") return "0x";
  const hex = normalizeHex(value, name);
  if (hex.length % 2 !== 0) {
    throw new Error(`${name} must be byte-aligned hex.`);
  }
  return hex;
}

function normalizeBigInt(value: unknown, name: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`${name} must be an unsigned integer.`);
}

function normalizeOptionalBigInt(value: unknown, name: string): bigint | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeBigInt(value, name);
}

function normalizeOptionalChainId(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = normalizeBigInt(value, name);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  const chainId = Number(parsed);
  if (chainId <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return chainId;
}

function normalizeRequiredChainId(value: unknown, name: string): number {
  const chainId = normalizeOptionalChainId(value, name);
  if (chainId === undefined) {
    throw new Error(`${name} is required.`);
  }
  return chainId;
}

function normalizeZeroNativeValue(value: unknown, name: string): 0n {
  const parsed = normalizeOptionalBigInt(value, name) ?? 0n;
  if (parsed !== 0n) {
    throw new Error(`${name} must be zero for RateLoop agent transaction plans.`);
  }
  return 0n;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertExactKeys(record: JsonRecord, expected: readonly string[], name: string) {
  const expectedSet = new Set(expected);
  const extras = Object.keys(record).filter(key => !expectedSet.has(key));
  const missing = expected.filter(key => record[key] === undefined);
  if (extras.length > 0 || missing.length > 0) {
    const unexpectedSuffix = extras.length ? `; unexpected ${extras.join(", ")}` : "";
    const missingSuffix = missing.length ? `; missing ${missing.join(", ")}` : "";
    throw new Error(
      `${name} must contain exactly ${expected.join(", ")}${unexpectedSuffix}${missingSuffix}.`,
    );
  }
}

function stripEip712Domain(types: Record<string, TypedDataField[]>): Record<string, TypedDataField[]> {
  const { EIP712Domain: _domain, ...rest } = types;
  return rest;
}

function readTypedDataFields(types: unknown): Record<string, TypedDataField[]> {
  const record = assertRecord(types, "x402 typedData.types");
  const parsed: Record<string, TypedDataField[]> = {};

  for (const [typeName, fields] of Object.entries(record)) {
    if (!Array.isArray(fields)) {
      throw new Error(`x402 typedData.types.${typeName} must be an array.`);
    }
    parsed[typeName] = fields.map((field, index) => {
      const fieldRecord = assertRecord(field, `x402 typedData.types.${typeName}[${index}]`);
      if (typeof fieldRecord.name !== "string" || typeof fieldRecord.type !== "string") {
        throw new Error(`x402 typedData.types.${typeName}[${index}] must include name and type.`);
      }
      return { name: fieldRecord.name, type: fieldRecord.type };
    });
  }

  return parsed;
}

function normalizeTypedDataValue(value: unknown, type: string, types: Record<string, TypedDataField[]>): unknown {
  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) throw new Error(`Expected ${type} array value.`);
    const itemType = type.slice(0, -2);
    return value.map(item => normalizeTypedDataValue(item, itemType, types));
  }

  if (/^u?int([0-9]*)$/.test(type)) {
    return normalizeBigInt(value, type);
  }

  if (type === "address") {
    return normalizeAddress(value, type);
  }

  if (type === "bytes32") {
    return normalizeBytes32(value, type);
  }

  if (type === "bytes" || /^bytes[0-9]+$/.test(type)) {
    return normalizeHex(value, type);
  }

  const nested = types[type];
  if (nested) {
    const record = assertRecord(value, type);
    return normalizeTypedDataMessage(record, type, types);
  }

  return value;
}

function normalizeTypedDataMessage(
  message: JsonRecord,
  primaryType: string,
  types: Record<string, TypedDataField[]>,
): JsonRecord {
  const fields = types[primaryType];
  if (!fields) {
    throw new Error(`x402 typedData.types is missing primary type ${primaryType}.`);
  }

  return Object.fromEntries(
    fields.map(field => [field.name, normalizeTypedDataValue(message[field.name], field.type, types)]),
  );
}

function assertReceiveWithAuthorizationTypes(types: Record<string, TypedDataField[]>) {
  const typeNames = Object.keys(types);
  if (typeNames.length !== 1 || typeNames[0] !== X402_PRIMARY_TYPE) {
    throw new Error(`x402 typedData.types must contain only ${X402_PRIMARY_TYPE}.`);
  }
  const fields = types[X402_PRIMARY_TYPE];
  if (!fields || fields.length !== X402_AUTHORIZATION_FIELDS.length) {
    throw new Error(`x402 typedData.types.${X402_PRIMARY_TYPE} must contain the standard EIP-3009 fields.`);
  }
  for (const [index, expected] of X402_AUTHORIZATION_FIELDS.entries()) {
    const actual = fields[index];
    if (actual?.name !== expected.name || actual.type !== expected.type) {
      throw new Error(
        `x402 typedData.types.${X402_PRIMARY_TYPE}[${index}] must be ${expected.name} ${expected.type}.`,
      );
    }
  }
}

function normalizeX402Domain(domainRecord: JsonRecord) {
  assertExactKeys(domainRecord, ["chainId", "name", "verifyingContract", "version"], "x402 typedData.domain");
  const chainId = normalizeRequiredChainId(domainRecord.chainId, "x402 typedData.domain.chainId");
  if (domainRecord.name !== "USDC") {
    throw new Error("x402 typedData.domain.name must be USDC.");
  }
  if (domainRecord.version !== "2") {
    throw new Error("x402 typedData.domain.version must be 2.");
  }
  return {
    chainId,
    name: "USDC",
    verifyingContract: normalizeAddress(domainRecord.verifyingContract, "x402 typedData.domain.verifyingContract"),
    version: "2",
  };
}

function parseX402AuthorizationRequest(value: unknown): {
  authorization: X402Authorization;
  typedData: X402TypedData;
  typedDataDomain: ReturnType<typeof normalizeX402Domain>;
} {
  const request = assertRecord(value, "x402AuthorizationRequest");
  const typedDataRecord = assertRecord(request.typedData ?? request.eip712, "x402AuthorizationRequest.typedData");
  const primaryType = typedDataRecord.primaryType;
  if (primaryType !== X402_PRIMARY_TYPE) {
    throw new Error(`x402 typedData.primaryType must be ${X402_PRIMARY_TYPE}.`);
  }

  const types = stripEip712Domain(readTypedDataFields(typedDataRecord.types));
  assertReceiveWithAuthorizationTypes(types);
  const rawMessage = assertRecord(typedDataRecord.message, "x402 typedData.message");
  assertExactKeys(
    rawMessage,
    X402_AUTHORIZATION_FIELDS.map(field => field.name),
    "x402 typedData.message",
  );
  const normalizedMessage = normalizeTypedDataMessage(rawMessage, primaryType, types);
  const authorizationSource = assertRecord(
    request.authorization ?? rawMessage,
    "x402AuthorizationRequest.authorization",
  );
  assertExactKeys(
    authorizationSource,
    X402_AUTHORIZATION_FIELDS.map(field => field.name),
    "x402AuthorizationRequest.authorization",
  );
  const typedDataDomain = normalizeX402Domain(assertRecord(typedDataRecord.domain, "x402 typedData.domain"));

  const authorization: X402Authorization = {
    from: normalizeAddress(authorizationSource.from ?? rawMessage.from, "paymentAuthorization.from"),
    nonce: normalizeBytes32(authorizationSource.nonce ?? rawMessage.nonce, "paymentAuthorization.nonce"),
    to: normalizeAddress(authorizationSource.to ?? rawMessage.to, "paymentAuthorization.to"),
    validAfter: normalizeBigInt(
      authorizationSource.validAfter ?? rawMessage.validAfter,
      "paymentAuthorization.validAfter",
    ).toString(),
    validBefore: normalizeBigInt(
      authorizationSource.validBefore ?? rawMessage.validBefore,
      "paymentAuthorization.validBefore",
    ).toString(),
    value: normalizeBigInt(authorizationSource.value ?? rawMessage.value, "paymentAuthorization.value").toString(),
  };
  assertX402AuthorizationMatchesMessage(authorization, normalizedMessage);

  return {
    authorization,
    typedDataDomain,
    typedData: {
      domain: typedDataDomain,
      message: normalizedMessage,
      primaryType,
      types,
    },
  };
}

function assertX402AuthorizationMatchesMessage(authorization: X402Authorization, message: JsonRecord) {
  const messageFrom = normalizeAddress(message.from, "x402 typedData.message.from");
  const messageTo = normalizeAddress(message.to, "x402 typedData.message.to");
  if (!authorization.from || !sameAddress(authorization.from, messageFrom)) {
    throw new Error("x402 authorization.from must match typedData.message.from.");
  }
  if (!authorization.to || !sameAddress(authorization.to, messageTo)) {
    throw new Error("x402 authorization.to must match typedData.message.to.");
  }
  const integerFields = ["value", "validAfter", "validBefore"] as const;
  for (const field of integerFields) {
    if (
      normalizeBigInt(authorization[field], `paymentAuthorization.${field}`) !==
      normalizeBigInt(message[field], `x402 typedData.message.${field}`)
    ) {
      throw new Error(`x402 authorization.${field} must match typedData.message.${field}.`);
    }
  }
  if (
    !authorization.nonce ||
    authorization.nonce.toLowerCase() !==
      normalizeBytes32(message.nonce, "x402 typedData.message.nonce").toLowerCase()
  ) {
    throw new Error("x402 authorization.nonce must match typedData.message.nonce.");
  }
}

function resolveConfiguredUsdcAddress(
  config: Pick<LocalSignerConfig, "usdcAddress">,
  chainId: number,
): Address | undefined {
  return config.usdcAddress ?? X402_USDC_BY_CHAIN_ID[chainId];
}

function resolveConfiguredX402SubmitterAddress(
  config: Pick<LocalSignerConfig, "x402QuestionSubmitterAddress">,
  chainId: number,
): Address | undefined {
  return config.x402QuestionSubmitterAddress ?? getSharedDeploymentAddress(chainId, "X402QuestionSubmitter");
}

function normalizeExpectedAmount(value: SignX402AuthorizationOptions["expectedAmount"]): bigint | undefined {
  return value === undefined ? undefined : normalizeBigInt(value, "expected x402 payment amount");
}

function assertTrustedX402Authorization(
  account: PrivateKeyAccount,
  authorization: X402Authorization,
  typedDataDomain: ReturnType<typeof normalizeX402Domain>,
  options: SignX402AuthorizationOptions,
) {
  if (authorization.from && !sameAddress(authorization.from, account.address)) {
    throw new Error(`x402 authorization is for ${authorization.from}, but local signer is ${account.address}.`);
  }
  if (options.expectedChainId !== undefined && typedDataDomain.chainId !== options.expectedChainId) {
    throw new Error(
      `x402 authorization chainId ${typedDataDomain.chainId} does not match local signer chain ${options.expectedChainId}.`,
    );
  }
  if (!options.expectedUsdcAddress) {
    throw new Error("Cannot validate x402 authorization without a trusted USDC address for this chain.");
  }
  if (!sameAddress(typedDataDomain.verifyingContract, options.expectedUsdcAddress)) {
    throw new Error("x402 typedData.domain.verifyingContract must be the configured USDC token.");
  }
  if (!options.expectedX402QuestionSubmitterAddress) {
    throw new Error(
      "Cannot validate x402 authorization without a trusted RateLoop x402 submitter address for this chain.",
    );
  }
  if (!authorization.to || !sameAddress(authorization.to, options.expectedX402QuestionSubmitterAddress)) {
    throw new Error("x402 authorization.to must be the configured RateLoop x402 submitter.");
  }
  const expectedAmount = normalizeExpectedAmount(options.expectedAmount);
  if (
    expectedAmount !== undefined &&
    normalizeBigInt(authorization.value, "paymentAuthorization.value") !== expectedAmount
  ) {
    throw new Error("x402 authorization.value must equal the requested bounty amount.");
  }
  if (
    normalizeBigInt(authorization.validBefore, "paymentAuthorization.validBefore") <=
    normalizeBigInt(authorization.validAfter, "paymentAuthorization.validAfter")
  ) {
    throw new Error("x402 authorization.validBefore must be greater than validAfter.");
  }
}

async function deriveScryptKey(
  password: string,
  salt: Buffer,
  params: { dklen: number; n: number; p: number; r: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      Buffer.from(password),
      salt,
      params.dklen,
      {
        N: params.n,
        maxmem: Math.max(32 * 1024 * 1024, 128 * params.n * params.r * 2),
        p: params.p,
        r: params.r,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

async function encryptPrivateKey(privateKey: Hex, password: string, address: Address): Promise<KeystoreV3> {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const privateKeyBytes = Buffer.from(privateKey.slice(2), "hex");
  const derivedKey = await deriveScryptKey(password, salt, DEFAULT_SCRYPT_PARAMS);
  const cipher = createCipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(privateKeyBytes), cipher.final()]);
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);

  return {
    address: address.slice(2).toLowerCase(),
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "scrypt",
      kdfparams: {
        ...DEFAULT_SCRYPT_PARAMS,
        salt: salt.toString("hex"),
      },
      mac: keccak256(`0x${macInput.toString("hex")}`).slice(2),
    },
    version: KEYSTORE_VERSION,
  };
}

async function decryptLocalKeystore(path: string, password: string): Promise<Hex> {
  const raw = await readFile(path, "utf8");
  const keystore = JSON.parse(raw) as KeystoreV3;
  if (keystore.version !== KEYSTORE_VERSION) {
    throw new Error(`Unsupported keystore version: ${String(keystore.version)}.`);
  }
  if (keystore.crypto?.kdf !== "scrypt") {
    throw new Error(`Unsupported keystore KDF: ${String(keystore.crypto?.kdf)}.`);
  }
  if (keystore.crypto?.cipher !== "aes-128-ctr") {
    throw new Error(`Unsupported keystore cipher: ${String(keystore.crypto?.cipher)}.`);
  }

  const params = keystore.crypto.kdfparams;
  const salt = Buffer.from(params.salt, "hex");
  const ciphertext = Buffer.from(keystore.crypto.ciphertext, "hex");
  const derivedKey = await deriveScryptKey(password, salt, params);
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);
  const computedMac = Buffer.from(keccak256(`0x${macInput.toString("hex")}`).slice(2), "hex");
  const storedMac = Buffer.from(keystore.crypto.mac.replace(/^0x/, ""), "hex");

  if (computedMac.length !== storedMac.length || !timingSafeEqual(computedMac, storedMac)) {
    throw new Error("Keystore MAC mismatch. Check the local signer password.");
  }

  const iv = Buffer.from(keystore.crypto.cipherparams.iv, "hex");
  const decipher = createDecipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return `0x${privateKey.toString("hex")}` as Hex;
}

export function loadLocalSignerConfig(options: CliOptions = {}, env: NodeJS.ProcessEnv = process.env): LocalSignerConfig {
  const passwordEnvName = optionString(options, "password-env") ?? envString(env, "RATELOOP_LOCAL_SIGNER_PASSWORD_ENV");
  const keystorePassword =
    optionString(options, "keystore-password") ??
    (passwordEnvName ? envString(env, passwordEnvName) : undefined) ??
    envString(env, "RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD");

  return {
    chainId: parsePositiveInteger(optionString(options, "chain-id") ?? envString(env, "RATELOOP_CHAIN_ID"), "RATELOOP_CHAIN_ID"),
    chainName: optionString(options, "chain-name") ?? envString(env, "RATELOOP_CHAIN_NAME") ?? "RateLoop local signer chain",
    keystorePassword,
    keystorePath: optionString(options, "keystore") ?? envString(env, "RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH"),
    pollingIntervalMs:
      parsePositiveInteger(
        optionString(options, "polling-interval-ms") ?? envString(env, "RATELOOP_LOCAL_SIGNER_POLLING_INTERVAL_MS"),
        "RATELOOP_LOCAL_SIGNER_POLLING_INTERVAL_MS",
      ) ?? 2_000,
    privateKey: parsePrivateKey(
      optionString(options, "private-key") ?? envString(env, "RATELOOP_LOCAL_SIGNER_PRIVATE_KEY"),
      "RATELOOP_LOCAL_SIGNER_PRIVATE_KEY",
    ),
    receiptTimeoutMs:
      parsePositiveInteger(
        optionString(options, "receipt-timeout-ms") ?? envString(env, "RATELOOP_LOCAL_SIGNER_RECEIPT_TIMEOUT_MS"),
        "RATELOOP_LOCAL_SIGNER_RECEIPT_TIMEOUT_MS",
      ) ?? 120_000,
    rpcUrl: optionString(options, "rpc-url") ?? envString(env, "RATELOOP_RPC_URL"),
    usdcAddress: parseOptionalAddress(
      optionString(options, "usdc-address") ??
        envString(env, "RATELOOP_LOCAL_SIGNER_USDC_ADDRESS") ??
        envString(env, "RATELOOP_X402_USDC_ADDRESS"),
      "RATELOOP_LOCAL_SIGNER_USDC_ADDRESS",
    ),
    x402QuestionSubmitterAddress: parseOptionalAddress(
      optionString(options, "x402-submitter-address") ??
        envString(env, "RATELOOP_LOCAL_SIGNER_X402_SUBMITTER_ADDRESS") ??
        envString(env, "RATELOOP_X402_QUESTION_SUBMITTER_ADDRESS"),
      "RATELOOP_LOCAL_SIGNER_X402_SUBMITTER_ADDRESS",
    ),
  };
}

export async function loadLocalSignerWallet(config: LocalSignerConfig): Promise<LoadedLocalSignerWallet> {
  if (config.keystorePath && config.privateKey) {
    throw new Error("Set either RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH or RATELOOP_LOCAL_SIGNER_PRIVATE_KEY, not both.");
  }

  if (config.keystorePath) {
    if (!config.keystorePassword) {
      throw new Error("Set RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD to unlock the local signer keystore.");
    }
    const privateKey = await decryptLocalKeystore(resolve(config.keystorePath), config.keystorePassword);
    return { account: privateKeyToAccount(privateKey), source: "keystore" };
  }

  if (config.privateKey) {
    return { account: privateKeyToAccount(config.privateKey), source: "private-key" };
  }

  throw new Error("No local signer wallet configured. Set RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH or generate one with `wallet --generate`.");
}

export async function generateLocalSignerWallet(
  config: LocalSignerConfig,
  options: { overwrite?: boolean } = {},
): Promise<GeneratedLocalSignerWallet> {
  if (!config.keystorePath) {
    throw new Error("Set RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH or pass --keystore before generating a wallet.");
  }
  if (!config.keystorePassword) {
    throw new Error("Set RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD before generating a wallet.");
  }
  if (config.privateKey) {
    throw new Error("Refusing to generate a keystore while RATELOOP_LOCAL_SIGNER_PRIVATE_KEY is set.");
  }

  const keystorePath = resolve(config.keystorePath);
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const keystore = await encryptPrivateKey(privateKey, config.keystorePassword, account.address);
  await mkdir(dirname(keystorePath), { recursive: true });
  await writeFile(keystorePath, `${JSON.stringify(keystore, null, 2)}\n`, {
    flag: options.overwrite ? "w" : "wx",
    mode: 0o600,
  });
  await chmod(keystorePath, 0o600);

  return { account, keystorePath, source: "keystore" };
}

export function withLocalSignerWallet(payload: unknown, walletAddress: Address): AskHumansRequest {
  const request = assertRecord(payload, "ask payload") as AskHumansRequest;
  const requestedWallet = request.walletAddress;
  if (typeof requestedWallet === "string" && requestedWallet.trim() && !sameAddress(requestedWallet, walletAddress)) {
    throw new Error(`Ask payload walletAddress ${requestedWallet} does not match local signer ${walletAddress}.`);
  }

  return { ...request, walletAddress };
}

function withLocalSignerChainId(request: AskHumansRequest, chainId: number | undefined): AskHumansRequest {
  const requestedChainId = normalizeOptionalChainId(request.chainId, "ask payload chainId");
  if (chainId === undefined) {
    return requestedChainId === undefined ? request : { ...request, chainId: requestedChainId };
  }

  if (requestedChainId !== undefined && requestedChainId !== chainId) {
    throw new Error(`Ask payload chainId ${requestedChainId} does not match local signer chain ${chainId}.`);
  }

  return { ...request, chainId };
}

export async function signX402AuthorizationRequest(
  account: PrivateKeyAccount,
  x402AuthorizationRequest: unknown,
  options: SignX402AuthorizationOptions = {},
): Promise<X402Authorization> {
  const { authorization, typedData, typedDataDomain } = parseX402AuthorizationRequest(x402AuthorizationRequest);
  assertTrustedX402Authorization(account, authorization, typedDataDomain, {
    ...options,
    expectedChainId: options.expectedChainId ?? typedDataDomain.chainId,
    expectedUsdcAddress: options.expectedUsdcAddress ?? X402_USDC_BY_CHAIN_ID[typedDataDomain.chainId],
    expectedX402QuestionSubmitterAddress:
      options.expectedX402QuestionSubmitterAddress ??
      getSharedDeploymentAddress(typedDataDomain.chainId, "X402QuestionSubmitter"),
  });

  const signature = await account.signTypedData({
    domain: typedData.domain,
    message: typedData.message,
    primaryType: typedData.primaryType,
    types: typedData.types,
  } as never);

  return { ...authorization, signature };
}

async function resolveChain(config: LocalSignerConfig) {
  if (!config.rpcUrl) {
    throw new Error("Set RATELOOP_RPC_URL before executing local signer transaction plans.");
  }

  const probeClient = createPublicClient({ transport: http(config.rpcUrl) });
  const rpcChainId = await probeClient.getChainId();
  if (config.chainId !== undefined && rpcChainId !== config.chainId) {
    throw new Error(`RATELOOP_CHAIN_ID is ${config.chainId}, but RATELOOP_RPC_URL reports ${rpcChainId}.`);
  }

  return defineChain({
    id: rpcChainId,
    name: config.chainName,
    nativeCurrency: { decimals: 18, name: "Native token", symbol: "NATIVE" },
    rpcUrls: {
      default: { http: [config.rpcUrl] },
    },
  });
}

async function resolveConfiguredChainId(config: LocalSignerConfig): Promise<number | undefined> {
  if (config.rpcUrl) {
    return (await resolveChain(config)).id;
  }
  return config.chainId;
}

function summarizeReceipt(receipt: TransactionReceipt): LocalTransactionReceiptSummary {
  return {
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
    transactionHash: receipt.transactionHash,
  };
}

async function executeTransactionPlan(params: {
  account: PrivateKeyAccount;
  calls: RateLoopAgentWalletTransactionCall[];
  config: LocalSignerConfig;
  onProgress?: (event: LocalAskProgress) => void;
}): Promise<LocalTransactionExecutionSummary> {
  const chain = await resolveChain(params.config);
  const transport = http(params.config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({
    account: params.account,
    chain,
    transport,
  });
  const calls: LocalTransactionExecutionSummary["calls"] = [];

  for (const [index, call] of params.calls.entries()) {
    const to = normalizeAddress(call.to, `transactionPlan.calls[${index}].to`);
    const hash = await walletClient.sendTransaction({
      account: params.account,
      data: normalizeOptionalTransactionData(call.data, `transactionPlan.calls[${index}].data`),
      to,
      value: normalizeZeroNativeValue(call.value, `transactionPlan.calls[${index}].value`),
    });
    params.onProgress?.({ hash, index, phase: call.phase, type: "transaction_sent" });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      pollingInterval: params.config.pollingIntervalMs,
      timeout: params.config.receiptTimeoutMs,
    });
    const summary = summarizeReceipt(receipt);
    params.onProgress?.({ hash, index, receipt: summary, type: "transaction_confirmed" });
    if (receipt.status !== "success") {
      throw new Error(`transactionPlan.calls[${index}] reverted: ${hash}`);
    }

    calls.push({ hash, index, phase: call.phase, receipt: summary, to });
    if (typeof call.waitAfterMs === "number" && call.waitAfterMs > 0) {
      await new Promise(resolveWait => setTimeout(resolveWait, call.waitAfterMs));
    }
  }

  return {
    calls,
    transactionHashes: calls.map(call => call.hash),
  };
}

export async function askHumansWithLocalSigner(params: {
  account: PrivateKeyAccount;
  agent: Pick<RateLoopAgentClient, "askHumans" | "confirmAskTransactions">;
  config: LocalSignerConfig;
  onProgress?: (event: LocalAskProgress) => void;
  paymentMode?: AskHumansRequest["paymentMode"];
  payload: unknown;
}): Promise<LocalAskResult> {
  const expectedChainId = await resolveConfiguredChainId(params.config);
  const baseAsk = withLocalSignerChainId(withLocalSignerWallet(params.payload, params.account.address), expectedChainId);
  if (params.paymentMode) {
    baseAsk.paymentMode = params.paymentMode;
  }

  const initialAsk = await params.agent.askHumans(baseAsk);
  params.onProgress?.({ response: initialAsk, type: "ask_submitted" });

  let finalAsk = initialAsk;
  let signedX402Authorization = false;
  if (initialAsk.x402AuthorizationRequest) {
    if (baseAsk.chainId === undefined) {
      throw new Error("Ask payload chainId is required before signing an x402 authorization.");
    }
    const paymentAuthorization = await signX402AuthorizationRequest(params.account, initialAsk.x402AuthorizationRequest, {
      expectedChainId: baseAsk.chainId,
      expectedAmount: normalizeBigInt(baseAsk.bounty.amount, "ask payload bounty.amount"),
      expectedUsdcAddress: resolveConfiguredUsdcAddress(params.config, baseAsk.chainId),
      expectedX402QuestionSubmitterAddress: resolveConfiguredX402SubmitterAddress(params.config, baseAsk.chainId),
    });
    signedX402Authorization = true;
    params.onProgress?.({ type: "x402_signed" });

    finalAsk = await params.agent.askHumans({
      ...baseAsk,
      paymentAuthorization,
      paymentMode: "x402_authorization",
    });
    params.onProgress?.({ response: finalAsk, type: "x402_resubmitted" });
  }

  const calls = finalAsk.transactionPlan?.calls ?? [];
  if (!calls.length) {
    return {
      finalAsk,
      initialAsk,
      signedX402Authorization,
      walletAddress: params.account.address,
    };
  }

  if (!finalAsk.operationKey) {
    throw new Error("RateLoop returned a transaction plan without an operationKey.");
  }

  const transactions = await executeTransactionPlan({
    account: params.account,
    calls,
    config: params.config,
    onProgress: params.onProgress,
  });
  const confirmRequest: ConfirmAskTransactionsRequest = {
    operationKey: finalAsk.operationKey,
    transactionHashes: transactions.transactionHashes,
  };
  const confirmed = await params.agent.confirmAskTransactions(confirmRequest);
  params.onProgress?.({ response: confirmed, type: "transactions_confirmed" });

  return {
    confirmed,
    finalAsk,
    initialAsk,
    signedX402Authorization,
    transactions,
    walletAddress: params.account.address,
  };
}
