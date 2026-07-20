import { RateLoopSdkError } from "./errors";
import { HUMAN_ASSURANCE_AUDIENCE_POLICY_JSON_SCHEMA } from "./humanAssuranceSchema";
import {
  TOKENLESS_DATA_CLASSIFICATIONS,
  TOKENLESS_SCHEMA_VERSION,
  TOKENLESS_REVIEWER_SOURCES,
  TOKENLESS_VISIBILITIES,
  TOKENLESS_VERDICT_STATUSES,
  type TokenlessAskResponse,
  type TokenlessAttemptReserveAccounting,
  type TokenlessCompensationAccounting,
  type TokenlessEconomics,
  type TokenlessFeeAccounting,
  type TokenlessFrozenReviewEconomics,
  type TokenlessFundAccounting,
  type TokenlessPollContinuation,
  type TokenlessPaymentInstructions,
  TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION,
  type TokenlessX402AuthorizationSpec,
  type TokenlessQuoteResponse,
  type TokenlessRefundAccounting,
  type TokenlessRequestProfileReference,
  type TokenlessReviewerSource,
  type TokenlessResult,
  type TokenlessResultFeedback,
  type TokenlessVerdictStatus,
  type TokenlessWaitResponse,
} from "./tokenlessTypes";

type JsonRecord = Record<string, unknown>;
const ATOMIC_AMOUNT_PATTERN = /^(0|[1-9]\d*)$/;
const verdictStatuses = new Set<string>(TOKENLESS_VERDICT_STATUSES);
const reviewerSources = new Set<string>(TOKENLESS_REVIEWER_SOURCES);
const MIN_RESPONSE_WINDOW_SECONDS = 1_200;
const MAX_RESPONSE_WINDOW_SECONDS = 86_400;

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

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "an array");
  return value;
}

function atomic(value: unknown, path: string): string {
  const normalized = string(value, path);
  if (!ATOMIC_AMOUNT_PATTERN.test(normalized))
    invalid(path, "an unsigned base-10 atomic amount string");
  return normalized;
}

function responseWindowSeconds(value: unknown, path: string) {
  return integer(
    value,
    path,
    MIN_RESPONSE_WINDOW_SECONDS,
    MAX_RESPONSE_WINDOW_SECONDS,
  );
}

function requestProfileReference(
  value: unknown,
  path: string,
): TokenlessRequestProfileReference | null {
  if (value === null) return null;
  const input = record(value, path);
  const hash = string(input.hash, `${path}.hash`);
  if (!/^sha256:[0-9a-f]{64}$/.test(hash)) {
    invalid(`${path}.hash`, "a lowercase sha256 commitment");
  }
  return {
    id: string(input.id, `${path}.id`),
    version: integer(input.version, `${path}.version`, 1),
    hash: hash as `sha256:${string}`,
  };
}

function frozenReviewEconomics(
  value: unknown,
  path: string,
): TokenlessFrozenReviewEconomics | null {
  if (value === null) return null;
  const input = record(value, path);
  const panelSize = integer(input.panelSize, `${path}.panelSize`, 1, 500);
  if (input.compensationMode === "unpaid") {
    if (input.bountyPerSeatAtomic !== null) {
      invalid(
        `${path}.bountyPerSeatAtomic`,
        "null when compensationMode is unpaid",
      );
    }
    return { compensationMode: "unpaid", bountyPerSeatAtomic: null, panelSize };
  }
  if (input.compensationMode === "usdc") {
    const bountyPerSeatAtomic = atomic(
      input.bountyPerSeatAtomic,
      `${path}.bountyPerSeatAtomic`,
    );
    if (BigInt(bountyPerSeatAtomic) < 1n) {
      invalid(`${path}.bountyPerSeatAtomic`, "a positive atomic amount");
    }
    return { compensationMode: "usdc", bountyPerSeatAtomic, panelSize };
  }
  return invalid(`${path}.compensationMode`, "unpaid or usdc");
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

function reviewerSource(value: unknown, path: string): TokenlessReviewerSource {
  const normalized = string(value, path);
  if (!reviewerSources.has(normalized)) {
    invalid(path, `one of ${TOKENLESS_REVIEWER_SOURCES.join(", ")}`);
  }
  return normalized as TokenlessReviewerSource;
}

function bytes32(value: unknown, path: string): `0x${string}` {
  const normalized = string(value, path);
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    invalid(path, "a bytes32 hex value");
  }
  return normalized as `0x${string}`;
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
  const parsedPanel = {
    minimumReveals: integer(panel.minimumReveals, "panel.minimumReveals", 1),
    requestedSize: integer(panel.requestedSize, "panel.requestedSize", 1),
  };
  const parsedReviewEconomics = frozenReviewEconomics(
    input.reviewEconomics,
    "reviewEconomics",
  );
  if (
    parsedReviewEconomics !== null &&
    parsedReviewEconomics.panelSize !== parsedPanel.requestedSize
  ) {
    invalid("reviewEconomics.panelSize", "the frozen requested panel size");
  }

  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    quoteId: string(input.quoteId, "quoteId"),
    expiresAt: isoDate(input.expiresAt, "expiresAt"),
    economics: economics(input.economics, "economics"),
    audience: {
      admissionPolicyHash: bytes32(
        audience.admissionPolicyHash,
        "audience.admissionPolicyHash",
      ),
      label: string(audience.label, "audience.label"),
      source: reviewerSource(audience.source, "audience.source"),
    },
    panel: parsedPanel,
    responseWindowSeconds: responseWindowSeconds(
      input.responseWindowSeconds,
      "responseWindowSeconds",
    ),
    requestProfile: requestProfileReference(
      input.requestProfile,
      "requestProfile",
    ),
    reviewEconomics: parsedReviewEconomics,
    slo: {
      estimatedSeconds: integer(
        slo.estimatedSeconds,
        "slo.estimatedSeconds",
        1,
      ),
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

  const roundId = nullableString(input.roundId, "roundId");
  const commitDeadline =
    input.commitDeadline === null
      ? null
      : isoDate(input.commitDeadline, "commitDeadline");
  if ((roundId === null) !== (commitDeadline === null)) {
    invalid("commitDeadline", "null exactly until the response has a roundId");
  }
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    idempotencyKey: string(input.idempotencyKey, "idempotencyKey"),
    operationKey: string(input.operationKey, "operationKey"),
    roundId,
    status,
    responseWindowSeconds: responseWindowSeconds(
      input.responseWindowSeconds,
      "responseWindowSeconds",
    ),
    commitDeadline,
    requestProfile: requestProfileReference(
      input.requestProfile,
      "requestProfile",
    ),
    reviewEconomics: frozenReviewEconomics(
      input.reviewEconomics,
      "reviewEconomics",
    ),
    continuation: continuation(input.continuation, "continuation"),
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
  const transactionHash =
    input.transactionHash === null
      ? null
      : bytes32(input.transactionHash, "transactionHash");
  let authorizationSpec: TokenlessX402AuthorizationSpec | undefined;
  if (input.authorizationSpec !== undefined) {
    const spec = record(input.authorizationSpec, "authorizationSpec");
    const eip3009Domain = record(
      spec.eip3009Domain,
      "authorizationSpec.eip3009Domain",
    );
    const roundAuthorizationDomain = record(
      spec.roundAuthorizationDomain,
      "authorizationSpec.roundAuthorizationDomain",
    );
    const domain = (value: JsonRecord, path: string) => ({
      name: string(value.name, `${path}.name`),
      version: string(value.version, `${path}.version`),
      chainId: integer(value.chainId, `${path}.chainId`, 1),
      verifyingContract: address(
        value.verifyingContract,
        `${path}.verifyingContract`,
      ),
    });
    if (spec.schemaVersion !== TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION) {
      invalid(
        "authorizationSpec.schemaVersion",
        TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION,
      );
    }
    authorizationSpec = {
      schemaVersion: TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION,
      eip3009Domain: domain(eip3009Domain, "authorizationSpec.eip3009Domain"),
      roundAuthorizationDomain: domain(
        roundAuthorizationDomain,
        "authorizationSpec.roundAuthorizationDomain",
      ),
      validAfter: atomic(spec.validAfter, "authorizationSpec.validAfter"),
      validBefore: atomic(spec.validBefore, "authorizationSpec.validBefore"),
      nonce: bytes32(spec.nonce, "authorizationSpec.nonce"),
    };
    if (
      BigInt(authorizationSpec.validBefore) <=
      BigInt(authorizationSpec.validAfter)
    ) {
      invalid(
        "authorizationSpec.validBefore",
        "greater than authorizationSpec.validAfter",
      );
    }
    if (
      BigInt(authorizationSpec.validBefore) -
        BigInt(authorizationSpec.validAfter) >
      3_600n
    ) {
      invalid(
        "authorizationSpec.validBefore",
        "an authorization lifetime no longer than one hour",
      );
    }
    if (authorizationSpec.eip3009Domain.chainId !== Number(input.chainId)) {
      invalid(
        "authorizationSpec.eip3009Domain.chainId",
        "the payment instruction chainId",
      );
    }
    if (
      authorizationSpec.roundAuthorizationDomain.chainId !==
      Number(input.chainId)
    ) {
      invalid(
        "authorizationSpec.roundAuthorizationDomain.chainId",
        "the payment instruction chainId",
      );
    }
    if (
      authorizationSpec.eip3009Domain.verifyingContract.toLowerCase() !==
      String(input.usdcAddress).toLowerCase()
    ) {
      invalid(
        "authorizationSpec.eip3009Domain.verifyingContract",
        "the payment instruction usdcAddress",
      );
    }
    if (
      authorizationSpec.roundAuthorizationDomain.verifyingContract.toLowerCase() !==
      String(input.x402SubmitterAddress).toLowerCase()
    ) {
      invalid(
        "authorizationSpec.roundAuthorizationDomain.verifyingContract",
        "the payment instruction x402SubmitterAddress",
      );
    }
  }
  if (paymentMode === "x402" && !authorizationSpec) {
    invalid(
      "authorizationSpec",
      "the versioned x402 authorization specification",
    );
  }
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
      scoringBeaconRound: atomic(
        terms.scoringBeaconRound,
        "roundTerms.scoringBeaconRound",
      ),
      claimGracePeriod: atomic(
        terms.claimGracePeriod,
        "roundTerms.claimGracePeriod",
      ),
      feeRecipient: address(terms.feeRecipient, "roundTerms.feeRecipient"),
    },
    roundId: nullableString(input.roundId, "roundId"),
    transactionHash,
    ...(authorizationSpec ? { authorizationSpec } : {}),
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
    if (input.verdictStatus !== null && input.verdictStatus !== "pending") {
      invalid("verdictStatus", "pending or null while wait status is pending");
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
  if (parsedTerminal !== (parsedVerdictStatus !== "pending")) {
    invalid(
      "terminal",
      `false only for pending and true for terminal verdict statuses`,
    );
  }

  let parsedVerdict: TokenlessResult["verdict"] = null;
  if (input.verdict !== null) {
    const verdict = record(input.verdict, "verdict");
    parsedVerdict = {
      intervalBps:
        verdict.intervalBps === null
          ? null
          : (() => {
              const interval = record(
                verdict.intervalBps,
                "verdict.intervalBps",
              );
              const lower = integer(
                interval.lower,
                "verdict.intervalBps.lower",
                0,
                10_000,
              );
              const upper = integer(
                interval.upper,
                "verdict.intervalBps.upper",
                0,
                10_000,
              );
              if (lower > upper)
                invalid("verdict.intervalBps", "lower <= upper");
              return { lower, upper };
            })(),
      preferenceShareBps:
        verdict.preferenceShareBps === null
          ? null
          : integer(
              verdict.preferenceShareBps,
              "verdict.preferenceShareBps",
              0,
              10_000,
            ),
      selected: nullableString(verdict.selected, "verdict.selected"),
    };
  }
  if ((parsedVerdictStatus === "publishable") !== (parsedVerdict !== null)) {
    invalid("verdict", "present only for publishable results");
  }
  const feedback =
    input.feedback === undefined ? null : record(input.feedback, "feedback");
  const parsedFeedback: TokenlessResultFeedback = feedback
    ? {
        items: array(feedback.items, "feedback.items").map((value, index) => {
          const item = record(value, `feedback.items[${index}]`);
          const category = string(
            item.category,
            `feedback.items[${index}].category`,
          );
          if (
            ![
              "opinion",
              "evidence",
              "clarification",
              "concern",
              "bug_report",
              "other",
            ].includes(category)
          ) {
            invalid(
              `feedback.items[${index}].category`,
              "a supported feedback category",
            );
          }
          const body = string(
            item.body,
            `feedback.items[${index}].body`,
          ).trim();
          if (!body || body.length > 1_500)
            invalid(`feedback.items[${index}].body`, "1-1500 characters");
          const sourceUrl =
            item.sourceUrl === null
              ? null
              : httpUrl(item.sourceUrl, `feedback.items[${index}].sourceUrl`);
          if (sourceUrl && new URL(sourceUrl).protocol !== "https:") {
            invalid(`feedback.items[${index}].sourceUrl`, "an HTTPS URL");
          }
          return {
            category:
              category as TokenlessResultFeedback["items"][number]["category"],
            body,
            sourceUrl,
          };
        }),
        redactedCount: integer(
          feedback.redactedCount,
          "feedback.redactedCount",
          0,
        ),
      }
    : { items: [], redactedCount: 0 };
  if (
    !parsedTerminal &&
    (parsedFeedback.items.length > 0 || parsedFeedback.redactedCount > 0)
  ) {
    invalid("feedback", "empty until the result is terminal");
  }

  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    operationKey: string(input.operationKey, "operationKey"),
    roundId: string(input.roundId, "roundId"),
    verdictStatus: parsedVerdictStatus,
    terminal: parsedTerminal,
    responseWindowSeconds: responseWindowSeconds(
      input.responseWindowSeconds,
      "responseWindowSeconds",
    ),
    commitDeadline: isoDate(input.commitDeadline, "commitDeadline"),
    requestProfile: requestProfileReference(
      input.requestProfile,
      "requestProfile",
    ),
    reviewEconomics: frozenReviewEconomics(
      input.reviewEconomics,
      "reviewEconomics",
    ),
    economics: economics(input.economics, "economics"),
    audience: {
      admissionPolicyHash: bytes32(
        audience.admissionPolicyHash,
        "audience.admissionPolicyHash",
      ),
      label: string(audience.label, "audience.label"),
      participantCount: integer(
        audience.participantCount,
        "audience.participantCount",
      ),
      source: reviewerSource(audience.source, "audience.source"),
    },
    verdict: parsedVerdict,
    feedback: parsedFeedback,
    methodologyUrl: httpUrl(input.methodologyUrl, "methodologyUrl"),
    updatedAt: isoDate(input.updatedAt, "updatedAt"),
  };
}

const atomicAmountSchema = {
  pattern: "^(0|[1-9]\\d*)$",
  type: "string",
} as const;
const requestProfileReferenceSchema = {
  anyOf: [
    { type: "null" },
    {
      additionalProperties: false,
      properties: {
        id: { minLength: 1, type: "string" },
        version: { minimum: 1, type: "integer" },
        hash: { pattern: "^sha256:[0-9a-f]{64}$", type: "string" },
      },
      required: ["id", "version", "hash"],
      type: "object",
    },
  ],
} as const;
const frozenReviewEconomicsSchema = {
  anyOf: [
    { type: "null" },
    {
      additionalProperties: false,
      properties: {
        compensationMode: { const: "unpaid" },
        bountyPerSeatAtomic: { type: "null" },
        panelSize: { maximum: 500, minimum: 1, type: "integer" },
      },
      required: ["compensationMode", "bountyPerSeatAtomic", "panelSize"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        compensationMode: { const: "usdc" },
        bountyPerSeatAtomic: {
          pattern: "^[1-9]\\d*$",
          type: "string",
        },
        panelSize: { maximum: 500, minimum: 1, type: "integer" },
      },
      required: ["compensationMode", "bountyPerSeatAtomic", "panelSize"],
      type: "object",
    },
  ],
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

const privateReviewArtifactCommitmentsSchema = {
  additionalProperties: false,
  properties: {
    privateReviewId: { minLength: 1, type: "string" },
    source: { pattern: "^sha256:[0-9a-f]{64}$", type: "string" },
    suggestion: { pattern: "^sha256:[0-9a-f]{64}$", type: "string" },
    preparedRequestHash: { pattern: "^sha256:[0-9a-f]{64}$", type: "string" },
    economicsHash: { pattern: "^sha256:[0-9a-f]{64}$", type: "string" },
    reviewerSetHash: { pattern: "^sha256:[0-9a-f]{64}$", type: "string" },
  },
  required: [
    "privateReviewId",
    "source",
    "suggestion",
    "preparedRequestHash",
    "economicsHash",
    "reviewerSetHash",
  ],
  type: "object",
} as const;

/** Public API schema for quote requests, including exact private paid-review commitments. */
export const TOKENLESS_QUOTE_REQUEST_JSON_SCHEMA = {
  $id: "urn:rateloop:tokenless:quote-request:v2",
  additionalProperties: false,
  properties: {
    visibility: { enum: TOKENLESS_VISIBILITIES },
    dataClassification: { enum: TOKENLESS_DATA_CLASSIFICATIONS },
    redactionSummary: { minLength: 1, type: "string" },
    confirmedNoSensitiveData: { type: "boolean" },
    audience: {
      additionalProperties: false,
      properties: {
        admissionPolicyHash: { pattern: "^0x[0-9a-fA-F]{64}$", type: "string" },
        source: { enum: TOKENLESS_REVIEWER_SOURCES },
      },
      required: ["admissionPolicyHash", "source"],
      type: "object",
    },
    audiencePolicy: {
      ...HUMAN_ASSURANCE_AUDIENCE_POLICY_JSON_SCHEMA,
      additionalProperties: false,
    },
    privateReview: {
      additionalProperties: false,
      properties: {
        schemaVersion: { const: "rateloop.tokenless-private-review.v1" },
        artifactCommitments: privateReviewArtifactCommitmentsSchema,
      },
      required: ["schemaVersion", "artifactCommitments"],
      type: "object",
    },
    budget: {
      additionalProperties: false,
      properties: {
        attemptReserveAtomic: atomicAmountSchema,
        bountyAtomic: { pattern: "^[1-9]\\d*$", type: "string" },
        feeBps: { maximum: 2_000, minimum: 0, type: "integer" },
      },
      required: ["attemptReserveAtomic", "bountyAtomic", "feeBps"],
      type: "object",
    },
    question: { type: "object" },
    requestedPanelSize: { maximum: 500, minimum: 3, type: "integer" },
    responseWindowSeconds: {
      maximum: MAX_RESPONSE_WINDOW_SECONDS,
      minimum: MIN_RESPONSE_WINDOW_SECONDS,
      type: "integer",
    },
    requestProfile: requestProfileReferenceSchema.anyOf[1],
    reviewEconomics: { anyOf: frozenReviewEconomicsSchema.anyOf.slice(1) },
  },
  required: [
    "audience",
    "audiencePolicy",
    "budget",
    "question",
    "requestedPanelSize",
    "responseWindowSeconds",
  ],
  title: "RateLoop tokenless quote request v2",
  type: "object",
} as const;

export const TOKENLESS_RESULT_JSON_SCHEMA = {
  $id: "urn:rateloop:tokenless:result:v2",
  additionalProperties: false,
  properties: {
    schemaVersion: { const: TOKENLESS_SCHEMA_VERSION },
    operationKey: { minLength: 1, type: "string" },
    roundId: { minLength: 1, type: "string" },
    verdictStatus: { enum: TOKENLESS_VERDICT_STATUSES },
    terminal: { type: "boolean" },
    responseWindowSeconds: {
      maximum: MAX_RESPONSE_WINDOW_SECONDS,
      minimum: MIN_RESPONSE_WINDOW_SECONDS,
      type: "integer",
    },
    commitDeadline: { format: "date-time", type: "string" },
    requestProfile: requestProfileReferenceSchema,
    reviewEconomics: frozenReviewEconomicsSchema,
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
        admissionPolicyHash: {
          pattern: "^0x[0-9a-fA-F]{64}$",
          type: "string",
        },
        label: { minLength: 1, type: "string" },
        participantCount: { minimum: 0, type: "integer" },
        source: { enum: TOKENLESS_REVIEWER_SOURCES },
      },
      required: ["admissionPolicyHash", "label", "participantCount", "source"],
      type: "object",
    },
    verdict: {
      anyOf: [
        { type: "null" },
        {
          additionalProperties: false,
          properties: {
            intervalBps: {
              anyOf: [
                { type: "null" },
                {
                  additionalProperties: false,
                  properties: {
                    lower: { maximum: 10_000, minimum: 0, type: "integer" },
                    upper: { maximum: 10_000, minimum: 0, type: "integer" },
                  },
                  required: ["lower", "upper"],
                  type: "object",
                },
              ],
            },
            preferenceShareBps: {
              maximum: 10_000,
              minimum: 0,
              type: ["integer", "null"],
            },
            selected: { type: ["string", "null"] },
          },
          required: ["intervalBps", "preferenceShareBps", "selected"],
          type: "object",
        },
      ],
    },
    feedback: {
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            additionalProperties: false,
            properties: {
              category: {
                enum: [
                  "opinion",
                  "evidence",
                  "clarification",
                  "concern",
                  "bug_report",
                  "other",
                ],
              },
              body: { minLength: 1, maxLength: 1500, type: "string" },
              sourceUrl: { format: "uri", type: ["string", "null"] },
            },
            required: ["category", "body", "sourceUrl"],
            type: "object",
          },
        },
        redactedCount: { minimum: 0, type: "integer" },
      },
      required: ["items", "redactedCount"],
      type: "object",
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
    "responseWindowSeconds",
    "commitDeadline",
    "requestProfile",
    "reviewEconomics",
    "economics",
    "audience",
    "verdict",
    "feedback",
    "methodologyUrl",
    "updatedAt",
  ],
  title: "RateLoop tokenless result v2",
  type: "object",
} as const;
