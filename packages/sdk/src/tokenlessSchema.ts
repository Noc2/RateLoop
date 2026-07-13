import { RateLoopSdkError } from "./errors";
import {
  TOKENLESS_SCHEMA_VERSION,
  TOKENLESS_VERDICT_STATUSES,
  TOKENLESS_WEBHOOK_EVENT_TYPES,
  type TokenlessAskResponse,
  type TokenlessAttemptReserveAccounting,
  type TokenlessCompensationAccounting,
  type TokenlessEconomics,
  type TokenlessFeeAccounting,
  type TokenlessFundAccounting,
  type TokenlessPollContinuation,
  type TokenlessPaymentInstructions,
  type TokenlessQuoteResponse,
  type TokenlessRefundAccounting,
  type TokenlessResult,
  type TokenlessVerdictStatus,
  type TokenlessWaitResponse,
  type TokenlessWebhookEvent,
} from "./tokenlessTypes";

type JsonRecord = Record<string, unknown>;
const ATOMIC_AMOUNT_PATTERN = /^(0|[1-9]\d*)$/;
const verdictStatuses = new Set<string>(TOKENLESS_VERDICT_STATUSES);
const webhookEventTypes = new Set<string>(TOKENLESS_WEBHOOK_EVENT_TYPES);

function invalid(path: string, expectation: string): never {
  throw new RateLoopSdkError(
    `Invalid tokenless response at ${path}: expected ${expectation}.`,
  );
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path, "an object");
  return value as JsonRecord;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim())
    invalid(path, "a non-empty string");
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function integer(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(path, `an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function atomic(value: unknown, path: string): string {
  const normalized = string(value, path);
  if (!ATOMIC_AMOUNT_PATTERN.test(normalized))
    invalid(path, "an unsigned base-10 atomic amount string");
  return normalized;
}

function isoDate(value: unknown, path: string): string {
  const normalized = string(value, path);
  if (!Number.isFinite(Date.parse(normalized)))
    invalid(path, "an ISO-8601 timestamp");
  return normalized;
}

function httpUrl(value: unknown, path: string): string {
  const normalized = string(value, path);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    invalid(path, "an http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    invalid(path, "an http(s) URL");
  return normalized;
}

function schemaVersion(
  value: unknown,
  path = "schemaVersion",
): typeof TOKENLESS_SCHEMA_VERSION {
  if (value !== TOKENLESS_SCHEMA_VERSION)
    invalid(path, TOKENLESS_SCHEMA_VERSION);
  return TOKENLESS_SCHEMA_VERSION;
}

function verdictStatus(value: unknown, path: string): TokenlessVerdictStatus {
  const normalized = string(value, path);
  if (!verdictStatuses.has(normalized))
    invalid(path, `one of ${TOKENLESS_VERDICT_STATUSES.join(", ")}`);
  return normalized as TokenlessVerdictStatus;
}

function fundAccounting(value: unknown, path: string): TokenlessFundAccounting {
  const input = record(value, path);
  return {
    fundedAtomic: atomic(input.fundedAtomic, `${path}.fundedAtomic`),
    paidAtomic: atomic(input.paidAtomic, `${path}.paidAtomic`),
    refundedAtomic: atomic(input.refundedAtomic, `${path}.refundedAtomic`),
  };
}

function feeAccounting(value: unknown, path: string): TokenlessFeeAccounting {
  const input = record(value, path);
  return {
    ...fundAccounting(input, path),
    bps: integer(input.bps, `${path}.bps`, 0, 2_000),
  };
}

function attemptReserveAccounting(
  value: unknown,
  path: string,
): TokenlessAttemptReserveAccounting {
  const input = record(value, path);
  return {
    compensatedAtomic: atomic(
      input.compensatedAtomic,
      `${path}.compensatedAtomic`,
    ),
    fundedAtomic: atomic(input.fundedAtomic, `${path}.fundedAtomic`),
    refundedAtomic: atomic(input.refundedAtomic, `${path}.refundedAtomic`),
  };
}

function refundAccounting(
  value: unknown,
  path: string,
): TokenlessRefundAccounting {
  const input = record(value, path);
  return {
    attemptReserveAtomic: atomic(
      input.attemptReserveAtomic,
      `${path}.attemptReserveAtomic`,
    ),
    bountyAtomic: atomic(input.bountyAtomic, `${path}.bountyAtomic`),
    feeAtomic: atomic(input.feeAtomic, `${path}.feeAtomic`),
    totalAtomic: atomic(input.totalAtomic, `${path}.totalAtomic`),
  };
}

function compensationAccounting(
  value: unknown,
  path: string,
): TokenlessCompensationAccounting {
  const input = record(value, path);
  return {
    perAcceptedRevealCapAtomic: atomic(
      input.perAcceptedRevealCapAtomic,
      `${path}.perAcceptedRevealCapAtomic`,
    ),
    recipientCount: integer(input.recipientCount, `${path}.recipientCount`),
    totalAtomic: atomic(input.totalAtomic, `${path}.totalAtomic`),
  };
}

function economics(value: unknown, path: string): TokenlessEconomics {
  const input = record(value, path);
  if (input.asset !== "USDC") invalid(`${path}.asset`, "USDC");
  if (input.decimals !== 6) invalid(`${path}.decimals`, "6");

  return {
    asset: "USDC",
    decimals: 6,
    bounty: fundAccounting(input.bounty, `${path}.bounty`),
    fee: feeAccounting(input.fee, `${path}.fee`),
    attemptReserve: attemptReserveAccounting(
      input.attemptReserve,
      `${path}.attemptReserve`,
    ),
    refund: refundAccounting(input.refund, `${path}.refund`),
    compensation: compensationAccounting(
      input.compensation,
      `${path}.compensation`,
    ),
    totalFundedAtomic: atomic(
      input.totalFundedAtomic,
      `${path}.totalFundedAtomic`,
    ),
  };
}

function continuation(value: unknown, path: string): TokenlessPollContinuation {
  const input = record(value, path);
  return {
    cursor: string(input.cursor, `${path}.cursor`),
    expiresAt: isoDate(input.expiresAt, `${path}.expiresAt`),
    pollUrl: httpUrl(input.pollUrl, `${path}.pollUrl`),
    retryAfterMs: integer(input.retryAfterMs, `${path}.retryAfterMs`, 1),
  };
}

export function parseTokenlessQuoteResponse(
  value: unknown,
): TokenlessQuoteResponse {
  const input = record(value, "response");
  const audience = record(input.audience, "audience");
  const panel = record(input.panel, "panel");
  const slo = record(input.slo, "slo");

  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    quoteId: string(input.quoteId, "quoteId"),
    expiresAt: isoDate(input.expiresAt, "expiresAt"),
    economics: economics(input.economics, "economics"),
    audience: {
      tierId: string(audience.tierId, "audience.tierId"),
      label: string(audience.label, "audience.label"),
    },
    panel: {
      minimumReveals: integer(panel.minimumReveals, "panel.minimumReveals", 1),
      requestedSize: integer(panel.requestedSize, "panel.requestedSize", 1),
    },
    slo: {
      estimatedSeconds: integer(
        slo.estimatedSeconds,
        "slo.estimatedSeconds",
        1,
      ),
      tierId: string(slo.tierId, "slo.tierId"),
    },
  };
}

export function parseTokenlessAskResponse(
  value: unknown,
): TokenlessAskResponse {
  const input = record(value, "response");
  const status = string(input.status, "status");
  if (
    status !== "awaiting_payment" &&
    status !== "submitted" &&
    status !== "open"
  ) {
    invalid("status", "awaiting_payment, submitted, or open");
  }

  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    idempotencyKey: string(input.idempotencyKey, "idempotencyKey"),
    operationKey: string(input.operationKey, "operationKey"),
    roundId: nullableString(input.roundId, "roundId"),
    status,
    continuation: continuation(input.continuation, "continuation"),
    webhookAccepted: boolean(input.webhookAccepted, "webhookAccepted"),
  };
}

export function parseTokenlessPaymentInstructions(
  value: unknown,
): TokenlessPaymentInstructions {
  const input = record(value, "response");
  const terms = record(input.roundTerms, "roundTerms");
  const paymentMode = string(input.paymentMode, "paymentMode");
  if (
    paymentMode !== "wallet" &&
    paymentMode !== "x402" &&
    paymentMode !== "prepaid"
  ) {
    invalid("paymentMode", "wallet, x402, or prepaid");
  }
  const address = (entry: unknown, path: string) => {
    const value = string(entry, path);
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) invalid(path, "an EVM address");
    return value as `0x${string}`;
  };
  const bytes32 = (entry: unknown, path: string) => {
    const value = string(entry, path);
    if (!/^0x[0-9a-fA-F]{64}$/.test(value))
      invalid(path, "a bytes32 hex value");
    return value as `0x${string}`;
  };
  const transactionHash =
    input.transactionHash === null
      ? null
      : bytes32(input.transactionHash, "transactionHash");
  return {
    operationKey: string(input.operationKey, "operationKey"),
    paymentMode,
    paymentState: string(input.paymentState, "paymentState"),
    deploymentKey: string(input.deploymentKey, "deploymentKey"),
    chainId: integer(input.chainId, "chainId", 1),
    panelAddress: address(input.panelAddress, "panelAddress"),
    x402SubmitterAddress: address(
      input.x402SubmitterAddress,
      "x402SubmitterAddress",
    ),
    usdcAddress: address(input.usdcAddress, "usdcAddress"),
    funderAddress: address(input.funderAddress, "funderAddress"),
    totalFundedAtomic: atomic(input.totalFundedAtomic, "totalFundedAtomic"),
    roundTerms: {
      contentId: bytes32(terms.contentId, "roundTerms.contentId"),
      termsHash: bytes32(terms.termsHash, "roundTerms.termsHash"),
      beaconNetworkHash: bytes32(
        terms.beaconNetworkHash,
        "roundTerms.beaconNetworkHash",
      ),
      bountyAmount: atomic(terms.bountyAmount, "roundTerms.bountyAmount"),
      feeAmount: atomic(terms.feeAmount, "roundTerms.feeAmount"),
      attemptReserve: atomic(terms.attemptReserve, "roundTerms.attemptReserve"),
      attemptCompensation: atomic(
        terms.attemptCompensation,
        "roundTerms.attemptCompensation",
      ),
      minimumReveals: integer(
        terms.minimumReveals,
        "roundTerms.minimumReveals",
        1,
      ),
      maximumCommits: integer(
        terms.maximumCommits,
        "roundTerms.maximumCommits",
        1,
      ),
      admissionPolicyHash: bytes32(
        terms.admissionPolicyHash,
        "roundTerms.admissionPolicyHash",
      ),
      commitDeadline: atomic(terms.commitDeadline, "roundTerms.commitDeadline"),
      revealDeadline: atomic(terms.revealDeadline, "roundTerms.revealDeadline"),
      beaconFailureDeadline: atomic(
        terms.beaconFailureDeadline,
        "roundTerms.beaconFailureDeadline",
      ),
      beaconRound: atomic(terms.beaconRound, "roundTerms.beaconRound"),
      claimGracePeriod: atomic(
        terms.claimGracePeriod,
        "roundTerms.claimGracePeriod",
      ),
      feeRecipient: address(terms.feeRecipient, "roundTerms.feeRecipient"),
    },
    roundId: nullableString(input.roundId, "roundId"),
    transactionHash,
  };
}

export function parseTokenlessWaitResponse(
  value: unknown,
): TokenlessWaitResponse {
  const input = record(value, "response");
  const common = {
    schemaVersion: schemaVersion(input.schemaVersion),
    operationKey: string(input.operationKey, "operationKey"),
  };

  if (input.status === "pending") {
    if (
      input.verdictStatus !== null &&
      input.verdictStatus !== "pending_analytics"
    ) {
      invalid(
        "verdictStatus",
        "pending_analytics or null while wait status is pending",
      );
    }
    return {
      ...common,
      status: "pending",
      verdictStatus: input.verdictStatus,
      continuation: continuation(input.continuation, "continuation"),
    };
  }

  if (input.status === "ready") {
    if (input.continuation !== null)
      invalid("continuation", "null while wait status is ready");
    return {
      ...common,
      status: "ready",
      verdictStatus: verdictStatus(input.verdictStatus, "verdictStatus"),
      continuation: null,
    };
  }

  return invalid("status", "pending or ready");
}

export function parseTokenlessResult(value: unknown): TokenlessResult {
  const input = record(value, "response");
  const audience = record(input.audience, "audience");
  const parsedVerdictStatus = verdictStatus(
    input.verdictStatus,
    "verdictStatus",
  );
  const parsedTerminal = boolean(input.terminal, "terminal");
  if (parsedTerminal !== (parsedVerdictStatus !== "pending_analytics")) {
    invalid(
      "terminal",
      `false only for pending_analytics and true for terminal verdict statuses`,
    );
  }

  let parsedVerdict: TokenlessResult["verdict"] = null;
  if (input.verdict !== null) {
    const verdict = record(input.verdict, "verdict");
    parsedVerdict = {
      confidenceBps:
        verdict.confidenceBps === null
          ? null
          : integer(verdict.confidenceBps, "verdict.confidenceBps", 0, 10_000),
      scoreBps:
        verdict.scoreBps === null
          ? null
          : integer(verdict.scoreBps, "verdict.scoreBps", 0, 10_000),
      selected: nullableString(verdict.selected, "verdict.selected"),
    };
  }

  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    operationKey: string(input.operationKey, "operationKey"),
    roundId: string(input.roundId, "roundId"),
    verdictStatus: parsedVerdictStatus,
    terminal: parsedTerminal,
    economics: economics(input.economics, "economics"),
    audience: {
      tierId: string(audience.tierId, "audience.tierId"),
      label: string(audience.label, "audience.label"),
      participantCount: integer(
        audience.participantCount,
        "audience.participantCount",
      ),
    },
    verdict: parsedVerdict,
    methodologyUrl: httpUrl(input.methodologyUrl, "methodologyUrl"),
    updatedAt: isoDate(input.updatedAt, "updatedAt"),
  };
}

export function parseTokenlessWebhookEvent(
  value: unknown,
): TokenlessWebhookEvent {
  const input = record(value, "event");
  const eventType = string(input.eventType, "eventType");
  if (!webhookEventTypes.has(eventType))
    invalid("eventType", TOKENLESS_WEBHOOK_EVENT_TYPES.join(" or "));

  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    eventId: string(input.eventId, "eventId"),
    eventType: eventType as TokenlessWebhookEvent["eventType"],
    occurredAt: isoDate(input.occurredAt, "occurredAt"),
    operationKey: string(input.operationKey, "operationKey"),
    verdictStatus: verdictStatus(input.verdictStatus, "verdictStatus"),
    resultUrl: httpUrl(input.resultUrl, "resultUrl"),
  };
}

const atomicAmountSchema = {
  pattern: "^(0|[1-9]\\d*)$",
  type: "string",
} as const;
const fundAccountingSchema = {
  additionalProperties: false,
  properties: {
    fundedAtomic: atomicAmountSchema,
    paidAtomic: atomicAmountSchema,
    refundedAtomic: atomicAmountSchema,
  },
  required: ["fundedAtomic", "paidAtomic", "refundedAtomic"],
  type: "object",
} as const;

export const TOKENLESS_RESULT_JSON_SCHEMA = {
  $id: "urn:rateloop:tokenless:result:v1",
  additionalProperties: false,
  properties: {
    schemaVersion: { const: TOKENLESS_SCHEMA_VERSION },
    operationKey: { minLength: 1, type: "string" },
    roundId: { minLength: 1, type: "string" },
    verdictStatus: { enum: TOKENLESS_VERDICT_STATUSES },
    terminal: { type: "boolean" },
    economics: {
      additionalProperties: false,
      properties: {
        asset: { const: "USDC" },
        decimals: { const: 6 },
        bounty: fundAccountingSchema,
        fee: {
          ...fundAccountingSchema,
          properties: {
            ...fundAccountingSchema.properties,
            bps: { maximum: 2_000, minimum: 0, type: "integer" },
          },
          required: [...fundAccountingSchema.required, "bps"],
        },
        attemptReserve: {
          additionalProperties: false,
          properties: {
            compensatedAtomic: atomicAmountSchema,
            fundedAtomic: atomicAmountSchema,
            refundedAtomic: atomicAmountSchema,
          },
          required: ["compensatedAtomic", "fundedAtomic", "refundedAtomic"],
          type: "object",
        },
        refund: {
          additionalProperties: false,
          properties: {
            attemptReserveAtomic: atomicAmountSchema,
            bountyAtomic: atomicAmountSchema,
            feeAtomic: atomicAmountSchema,
            totalAtomic: atomicAmountSchema,
          },
          required: [
            "attemptReserveAtomic",
            "bountyAtomic",
            "feeAtomic",
            "totalAtomic",
          ],
          type: "object",
        },
        compensation: {
          additionalProperties: false,
          properties: {
            perAcceptedRevealCapAtomic: atomicAmountSchema,
            recipientCount: { minimum: 0, type: "integer" },
            totalAtomic: atomicAmountSchema,
          },
          required: [
            "perAcceptedRevealCapAtomic",
            "recipientCount",
            "totalAtomic",
          ],
          type: "object",
        },
        totalFundedAtomic: atomicAmountSchema,
      },
      required: [
        "asset",
        "decimals",
        "bounty",
        "fee",
        "attemptReserve",
        "refund",
        "compensation",
        "totalFundedAtomic",
      ],
      type: "object",
    },
    audience: {
      additionalProperties: false,
      properties: {
        tierId: { minLength: 1, type: "string" },
        label: { minLength: 1, type: "string" },
        participantCount: { minimum: 0, type: "integer" },
      },
      required: ["tierId", "label", "participantCount"],
      type: "object",
    },
    verdict: {
      anyOf: [
        { type: "null" },
        {
          additionalProperties: false,
          properties: {
            confidenceBps: {
              maximum: 10_000,
              minimum: 0,
              type: ["integer", "null"],
            },
            scoreBps: {
              maximum: 10_000,
              minimum: 0,
              type: ["integer", "null"],
            },
            selected: { type: ["string", "null"] },
          },
          required: ["confidenceBps", "scoreBps", "selected"],
          type: "object",
        },
      ],
    },
    methodologyUrl: { format: "uri", type: "string" },
    updatedAt: { format: "date-time", type: "string" },
  },
  required: [
    "schemaVersion",
    "operationKey",
    "roundId",
    "verdictStatus",
    "terminal",
    "economics",
    "audience",
    "verdict",
    "methodologyUrl",
    "updatedAt",
  ],
  title: "RateLoop tokenless result v1",
  type: "object",
} as const;
