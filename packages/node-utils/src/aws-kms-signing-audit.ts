export const EVM_KMS_SIGNING_FAILURE_CLASSES = [
  "timeout",
  "throttling",
  "access_or_key_configuration",
  "malformed_response_or_recovery",
  "outage",
] as const;

export type EvmKmsSigningFailureClass =
  (typeof EVM_KMS_SIGNING_FAILURE_CLASSES)[number];

export type EvmKmsSignerRole =
  | "credential_issuer"
  | "prepaid_funder"
  | "surprise_bonus_funder"
  | "x402_relayer"
  | "keeper";

export type EvmKmsSigningPurpose =
  | "raw_hash"
  | "eip191_message"
  | "eip712_typed_data"
  | "evm_transaction";

export type EvmKmsSigningLedgerEvent = Readonly<{
  eventId: string;
  attemptId: string;
  outcome: "attempted" | "succeeded" | "failed";
  signerRole: EvmKmsSignerRole;
  keyArn: string;
  digest: `0x${string}`;
  purpose: EvmKmsSigningPurpose;
  awsRequestId: string | null;
  errorClass: EvmKmsSigningFailureClass | null;
  retryable: boolean | null;
  signatureHash: `0x${string}` | null;
  transactionHash: `0x${string}` | null;
  startedAt: Date;
  completedAt: Date | null;
  recordedAt: Date;
}>;

export type EvmKmsSigningTerminalEvent = EvmKmsSigningLedgerEvent &
  Readonly<{ outcome: "succeeded" | "failed" }>;

export type EvmKmsSigningLedger = Readonly<{
  append(event: EvmKmsSigningLedgerEvent): Promise<void>;
  readTerminal(attemptId: string): Promise<EvmKmsSigningTerminalEvent | null>;
}>;

const RETRYABLE_FAILURE_CLASSES = new Set<EvmKmsSigningFailureClass>([
  "timeout",
  "throttling",
  "outage",
]);

const TIMEOUT_NAMES = new Set([
  "AbortError",
  "DependencyTimeoutException",
  "TimeoutError",
  "RequestTimeout",
  "RequestTimeoutException",
]);
const THROTTLING_NAMES = new Set([
  "LimitExceededException",
  "ProvisionedThroughputExceededException",
  "SlowDown",
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
]);
const ACCESS_OR_KEY_NAMES = new Set([
  "AccessDenied",
  "AccessDeniedException",
  "DisabledException",
  "ExpiredTokenException",
  "IncorrectKeyException",
  "InvalidArnException",
  "InvalidGrantTokenException",
  "InvalidKeyUsageException",
  "KMSInvalidStateException",
  "NotFoundException",
  "UnrecognizedClientException",
]);

type ErrorMetadata = {
  name?: unknown;
  code?: unknown;
  $metadata?: { requestId?: unknown };
};

function errorName(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const candidate = error as ErrorMetadata;
  if (typeof candidate.name === "string") return candidate.name;
  return typeof candidate.code === "string" ? candidate.code : "";
}

export function awsKmsRequestId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const requestId = (value as ErrorMetadata).$metadata?.requestId;
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : null;
}

export function isEvmKmsSigningFailureRetryable(
  errorClass: EvmKmsSigningFailureClass,
) {
  return RETRYABLE_FAILURE_CLASSES.has(errorClass);
}

export function classifyEvmKmsSigningFailure(
  error: unknown,
): EvmKmsSigningFailureClass {
  if (error instanceof EvmKmsSigningError) return error.errorClass;
  const name = errorName(error);
  if (TIMEOUT_NAMES.has(name)) return "timeout";
  if (THROTTLING_NAMES.has(name)) return "throttling";
  if (ACCESS_OR_KEY_NAMES.has(name)) return "access_or_key_configuration";
  return "outage";
}

export class EvmKmsSigningError extends Error {
  readonly errorClass: EvmKmsSigningFailureClass;
  readonly retryable: boolean;
  readonly awsRequestId: string | null;

  constructor(
    message: string,
    errorClass: EvmKmsSigningFailureClass,
    options?: { cause?: unknown; awsRequestId?: string | null },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "EvmKmsSigningError";
    this.errorClass = errorClass;
    this.retryable = isEvmKmsSigningFailureRetryable(errorClass);
    this.awsRequestId =
      options?.awsRequestId ?? awsKmsRequestId(options?.cause);
  }
}

export function normalizeEvmKmsSigningError(
  error: unknown,
  options?: {
    errorClass?: EvmKmsSigningFailureClass;
    message?: string;
    awsRequestId?: string | null;
  },
) {
  if (error instanceof EvmKmsSigningError) {
    if (!options?.errorClass && !options?.message && !options?.awsRequestId)
      return error;
    return new EvmKmsSigningError(
      options.message ?? error.message,
      options.errorClass ?? error.errorClass,
      {
        cause: error,
        awsRequestId: options.awsRequestId ?? error.awsRequestId,
      },
    );
  }
  return new EvmKmsSigningError(
    options?.message ?? "Managed EVM signer is unavailable.",
    options?.errorClass ?? classifyEvmKmsSigningFailure(error),
    {
      cause: error,
      awsRequestId: options?.awsRequestId ?? awsKmsRequestId(error),
    },
  );
}

function sameDate(left: Date | null, right: Date | null) {
  return left === null || right === null
    ? left === right
    : left.getTime() === right.getTime();
}

function sameTerminalEvent(
  left: EvmKmsSigningTerminalEvent,
  right: EvmKmsSigningTerminalEvent,
) {
  return (
    left.eventId === right.eventId &&
    left.attemptId === right.attemptId &&
    left.outcome === right.outcome &&
    left.signerRole === right.signerRole &&
    left.keyArn === right.keyArn &&
    left.digest === right.digest &&
    left.purpose === right.purpose &&
    left.awsRequestId === right.awsRequestId &&
    left.errorClass === right.errorClass &&
    left.retryable === right.retryable &&
    left.signatureHash === right.signatureHash &&
    left.transactionHash === right.transactionHash &&
    sameDate(left.startedAt, right.startedAt) &&
    sameDate(left.completedAt, right.completedAt) &&
    sameDate(left.recordedAt, right.recordedAt)
  );
}

export async function appendOrReconcileEvmKmsSigningTerminalEvent(
  ledger: EvmKmsSigningLedger,
  event: EvmKmsSigningTerminalEvent,
) {
  try {
    await ledger.append(event);
    return;
  } catch (appendError) {
    let recorded: EvmKmsSigningTerminalEvent | null;
    try {
      recorded = await ledger.readTerminal(event.attemptId);
    } catch (readError) {
      throw new EvmKmsSigningError(
        "Managed EVM signing audit ledger is unavailable.",
        "outage",
        {
          cause: new AggregateError(
            [appendError, readError],
            "Terminal ledger write and reconciliation failed.",
          ),
          awsRequestId: event.awsRequestId,
        },
      );
    }
    if (recorded && sameTerminalEvent(recorded, event)) return;
    throw new EvmKmsSigningError(
      "Managed EVM signing audit ledger is unavailable.",
      "outage",
      {
        cause: appendError,
        awsRequestId: event.awsRequestId,
      },
    );
  }
}
