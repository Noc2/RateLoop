export type CliOptionValue = string | boolean | string[];
export type CliOptions = Record<string, CliOptionValue>;

const POSITIVE_DECIMAL_INTEGER_PATTERN = /^[1-9]\d*$/;
const LOCAL_SIGNER_OPTIONS = [
  "chain-id",
  "chain-name",
  "content-registry-address",
  "feedback-bonus-escrow-address",
  "keystore",
  "keystore-password",
  "lrep-address",
  "password-env",
  "polling-interval-ms",
  "private-key",
  "question-metadata-base-url",
  "question-reward-pool-escrow-address",
  "receipt-timeout-ms",
  "rpc-url",
  "usdc-address",
  "x402-submitter-address",
] as const;
const COMMAND_OPTIONS: Record<string, ReadonlySet<string>> = {
  ask: new Set(["client-request-id", "dry-run", "file"]),
  handoff: new Set(["file", "generated-image", "image", "ttl-ms"]),
  "handoff-status": new Set([
    "handoff-id",
    "handoff-token",
    "include-image-data",
  ]),
  lint: new Set(["file"]),
  "local-ask": new Set([...LOCAL_SIGNER_OPTIONS, "file", "payment-mode"]),
  quote: new Set(["client-request-id", "dry-run", "file"]),
  result: new Set([
    "chain-id",
    "client-request-id",
    "content-id",
    "operation-key",
    "wallet-address",
  ]),
  sandbox: new Set(["client-request-id", "file"]),
  status: new Set([
    "chain-id",
    "client-request-id",
    "operation-key",
    "wallet-address",
  ]),
  templates: new Set(),
  wallet: new Set([...LOCAL_SIGNER_OPTIONS, "generate", "overwrite"]),
};
const REPEATABLE_OPTIONS = new Set(["generated-image", "image"]);

export function validateCliOptions(
  command: string,
  options: CliOptions,
): void {
  const allowed = COMMAND_OPTIONS[command];
  if (!allowed) return;

  for (const [name, value] of Object.entries(options)) {
    if (!allowed.has(name)) {
      throw new Error(`Unknown option --${name} for ${command}`);
    }
    if (Array.isArray(value) && !REPEATABLE_OPTIONS.has(name)) {
      throw new Error(`--${name} may only be specified once`);
    }
  }
}

export function readOptionalPositiveInteger(
  options: CliOptions,
  name: string,
): number | undefined {
  const value = options[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`--${name} must be a positive base-10 safe integer`);
  }
  if (!POSITIVE_DECIMAL_INTEGER_PATTERN.test(value)) {
    throw new Error(`--${name} must be a positive base-10 safe integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive base-10 safe integer`);
  }
  return parsed;
}

export function readBooleanFlag(options: CliOptions, name: string): boolean {
  const value = options[name];
  if (value === undefined) return false;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`--${name} must be a boolean flag`);
}
