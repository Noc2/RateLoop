export const EVM_SIGNING_FAILURE_CLASSES = [
  "timeout",
  "throttling",
  "access_or_key_configuration",
  "malformed_response_or_recovery",
  "outage",
] as const;

export type EvmSigningFailureClass =
  (typeof EVM_SIGNING_FAILURE_CLASSES)[number];

export type EvmSignerRole =
  | "credential_issuer"
  | "prepaid_funder"
  | "surprise_bonus_funder"
  | "x402_relayer"
  | "keeper";

export type EvmSigningPurpose =
  | "raw_hash"
  | "eip191_message"
  | "eip712_typed_data"
  | "evm_transaction";

export type EvmSigningLedgerEvent = Readonly<{
  eventId: string;
  attemptId: string;
  outcome: "attempted" | "succeeded" | "failed";
  signerRole: EvmSignerRole;
  provider: string;
  keyId: string;
  digest: `0x${string}`;
  purpose: EvmSigningPurpose;
  providerRequestId: string | null;
  errorClass: EvmSigningFailureClass | null;
  retryable: boolean | null;
  signatureHash: `0x${string}` | null;
  transactionHash: `0x${string}` | null;
  startedAt: Date;
  completedAt: Date | null;
  recordedAt: Date;
}>;

export type EvmSigningTerminalEvent = EvmSigningLedgerEvent &
  Readonly<{ outcome: "succeeded" | "failed" }>;

export type EvmSigningLedger = Readonly<{
  append(event: EvmSigningLedgerEvent): Promise<void>;
  readTerminal(attemptId: string): Promise<EvmSigningTerminalEvent | null>;
}>;

const RETRYABLE_FAILURE_CLASSES = new Set<EvmSigningFailureClass>([
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
  "InvalidKeyUsageException",
  "NotFoundException",
  "UnrecognizedClientException",
]);

type ErrorMetadata = {
  name?: unknown;
  code?: unknown;
  requestId?: unknown;
  $metadata?: { requestId?: unknown };
};

function errorName(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const candidate = error as ErrorMetadata;
  if (typeof candidate.name === "string") return candidate.name;
  return typeof candidate.code === "string" ? candidate.code : "";
}

export function providerRequestId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const metadata = value as ErrorMetadata;
  const requestId = metadata.requestId ?? metadata.$metadata?.requestId;
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : null;
}

export function isEvmSigningFailureRetryable(
  errorClass: EvmSigningFailureClass,
) {
  return RETRYABLE_FAILURE_CLASSES.has(errorClass);
}

export function classifyEvmSigningFailure(
  error: unknown,
): EvmSigningFailureClass {
  if (error instanceof EvmSigningError) return error.errorClass;
  const name = errorName(error);
  if (TIMEOUT_NAMES.has(name)) return "timeout";
  if (THROTTLING_NAMES.has(name)) return "throttling";
  if (ACCESS_OR_KEY_NAMES.has(name)) return "access_or_key_configuration";
  return "outage";
}

export class EvmSigningError extends Error {
  readonly errorClass: EvmSigningFailureClass;
  readonly retryable: boolean;
  readonly providerRequestId: string | null;

  constructor(
    message: string,
    errorClass: EvmSigningFailureClass,
    options?: { cause?: unknown; providerRequestId?: string | null },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "EvmSigningError";
    this.errorClass = errorClass;
    this.retryable = isEvmSigningFailureRetryable(errorClass);
    this.providerRequestId =
      options?.providerRequestId ?? providerRequestId(options?.cause);
  }
}

export function normalizeEvmSigningError(
  error: unknown,
  options?: {
    errorClass?: EvmSigningFailureClass;
    message?: string;
    providerRequestId?: string | null;
  },
) {
  if (error instanceof EvmSigningError) {
    if (
      !options?.errorClass &&
      !options?.message &&
      !options?.providerRequestId
    ) {
      return error;
    }
    return new EvmSigningError(
      options.message ?? error.message,
      options.errorClass ?? error.errorClass,
      {
        cause: error,
        providerRequestId:
          options.providerRequestId ?? error.providerRequestId,
      },
    );
  }
  return new EvmSigningError(
    options?.message ?? "Managed EVM signer is unavailable.",
    options?.errorClass ?? classifyEvmSigningFailure(error),
    {
      cause: error,
      providerRequestId:
        options?.providerRequestId ?? providerRequestId(error),
    },
  );
}

function sameDate(left: Date | null, right: Date | null) {
  return left === null || right === null
    ? left === right
    : left.getTime() === right.getTime();
}

function sameTerminalEvent(
  left: EvmSigningTerminalEvent,
  right: EvmSigningTerminalEvent,
) {
  return (
    left.eventId === right.eventId &&
    left.attemptId === right.attemptId &&
    left.outcome === right.outcome &&
    left.signerRole === right.signerRole &&
    left.provider === right.provider &&
    left.keyId === right.keyId &&
    left.digest === right.digest &&
    left.purpose === right.purpose &&
    left.providerRequestId === right.providerRequestId &&
    left.errorClass === right.errorClass &&
    left.retryable === right.retryable &&
    left.signatureHash === right.signatureHash &&
    left.transactionHash === right.transactionHash &&
    sameDate(left.startedAt, right.startedAt) &&
    sameDate(left.completedAt, right.completedAt) &&
    sameDate(left.recordedAt, right.recordedAt)
  );
}

export async function appendOrReconcileEvmSigningTerminalEvent(
  ledger: EvmSigningLedger,
  event: EvmSigningTerminalEvent,
) {
  try {
    await ledger.append(event);
    return;
  } catch (appendError) {
    let recorded: EvmSigningTerminalEvent | null;
    try {
      recorded = await ledger.readTerminal(event.attemptId);
    } catch (readError) {
      throw new EvmSigningError(
        "Managed EVM signing audit ledger is unavailable.",
        "outage",
        {
          cause: new AggregateError(
            [appendError, readError],
            "Terminal ledger write and reconciliation failed.",
          ),
          providerRequestId: event.providerRequestId,
        },
      );
    }
    if (recorded && sameTerminalEvent(recorded, event)) return;
    throw new EvmSigningError(
      "Managed EVM signing audit ledger is unavailable.",
      "outage",
      {
        cause: appendError,
        providerRequestId: event.providerRequestId,
      },
    );
  }
}
