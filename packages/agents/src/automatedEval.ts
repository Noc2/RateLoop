export const AUTOMATED_EVAL_RECEIPT_SCHEMA_VERSION =
  "rateloop.automated-eval-receipt.v1" as const;

export type AutomatedEvalProvider =
  | "promptfoo"
  | "nemo_guardrails"
  | "inspect"
  | "custom";
export type AutomatedEvalOutcome = "pass" | "fail" | "uncertain";

export type AutomatedEvalReviewContext = {
  policyId: string;
  policyVersion: number;
  workflowKey: string;
  riskTier: string;
  audiencePolicyHash: string;
  declaredConfidenceBps?: number | null;
  metadataComplete: boolean;
  execution: Record<string, unknown>;
};

export type AutomatedEvalReceipt = {
  schemaVersion: typeof AUTOMATED_EVAL_RECEIPT_SCHEMA_VERSION;
  provider: AutomatedEvalProvider;
  externalReceiptId: string;
  agentId: string;
  agentVersionId: string;
  evaluator: { name: string; version: string };
  evaluation: {
    checkName: string;
    outcome: AutomatedEvalOutcome;
    scoreBps?: number | null;
    thresholdBps?: number | null;
  };
  contentCommitment: string;
  observedAt: string;
  reviewContext?: AutomatedEvalReviewContext;
};

export type AutomatedEvalIngestResult = {
  schemaVersion: "rateloop.automated-eval-ingest-result.v1";
  receiptId: string;
  receiptHash: string;
  provider: AutomatedEvalProvider;
  automatedSignal: {
    sourceKind: "automated_evaluation";
    outcome: AutomatedEvalOutcome;
    scoreBps: number | null;
    thresholdBps: number | null;
    humanVerdict: null;
  };
  humanReview: null | {
    required: true;
    trigger: "guardrail_uncertain";
    opportunityId: string;
    decision: "required";
  };
  replayed: boolean;
};

export type AutomatedEvalLabeledDataItem = {
  receiptId: string;
  receiptHash: string;
  externalReferenceHash: string;
  provider: AutomatedEvalProvider;
  evaluator: { name: string; version: string };
  checkName: string;
  automatedOutcome: "uncertain";
  automatedScoreBps: number | null;
  automatedThresholdBps: number | null;
  contentCommitment: string;
  opportunityId: string;
  humanLabel: "positive" | "negative";
  humanResultCommitment: string;
  responseCount: number;
  observedAt: string;
  labeledAt: string;
};

export type AutomatedEvalLabeledDataExport = {
  schemaVersion: "rateloop.automated-eval-labeled-data.v1";
  workspaceId: string;
  window: { from: string; to: string; semantics: "[from,to)" };
  privacy: {
    contentMode: "commitments_only";
    reviewerIdentitiesIncluded: false;
    rawInputsIncluded: false;
    rawOutputsIncluded: false;
  };
  truncated: boolean;
  items: AutomatedEvalLabeledDataItem[];
  exportDigest: string;
};

export type AutomatedEvalResult = {
  schemaVersion: "rateloop.automated-eval-result.v1";
  receiptId: string;
  receiptHash: string;
  provider: AutomatedEvalProvider;
  evaluator: { name: string; version: string };
  checkName: string;
  contentCommitment: string;
  observedAt: string;
  automatedSignal: AutomatedEvalIngestResult["automatedSignal"];
  humanReview:
    | null
    | {
        required: true;
        trigger: "guardrail_uncertain";
        opportunityId: string;
        state: "pending" | "completed";
        verdict:
          | null
          | {
              label: "positive" | "negative" | "inconclusive";
              resultCommitment: string;
              responseCount: number;
              observedAt: string;
            };
      };
};

export type AutomatedEvalClient = {
  ingest(
    receipt: AutomatedEvalReceipt,
    options: { idempotencyKey: string },
  ): Promise<AutomatedEvalIngestResult>;
  getResult(receiptId: string): Promise<AutomatedEvalResult>;
  exportLabeledData(options?: {
    from?: string;
    to?: string;
  }): Promise<AutomatedEvalLabeledDataExport>;
};

export type AutomatedEvalClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  allowInsecureLocalhost?: boolean;
};

function serviceOrigin(value: string, allowInsecureLocalhost = false) {
  const url = new URL(value);
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "RateLoop baseUrl must be an origin without credentials, query, fragment, or path.",
    );
  }
  if (
    url.protocol !== "https:" &&
    !(allowInsecureLocalhost && local && url.protocol === "http:")
  ) {
    throw new Error(
      "RateLoop baseUrl must use HTTPS; HTTP is allowed only for explicit localhost testing.",
    );
  }
  return url.origin;
}

async function jsonResponse<ResponseBody>(
  response: Response,
): Promise<ResponseBody> {
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`RateLoop returned non-JSON HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const message =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { error?: unknown }).error === "string"
        ? (value as { error: string }).error
        : `RateLoop returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return value as ResponseBody;
}

export function createAutomatedEvalClient(
  options: AutomatedEvalClientOptions,
): AutomatedEvalClient {
  const origin = serviceOrigin(options.baseUrl, options.allowInsecureLocalhost);
  if (!options.apiKey.trim() || /\s/u.test(options.apiKey))
    throw new Error("RateLoop apiKey is invalid.");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async ingest(receipt, requestOptions) {
      const response = await fetchImpl(
        `${origin}/api/assurance/v1/evaluations/receipts`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": requestOptions.idempotencyKey,
          },
          body: JSON.stringify(receipt),
        },
      );
      return jsonResponse<AutomatedEvalIngestResult>(response);
    },
    async exportLabeledData(exportOptions = {}) {
      const url = new URL(
        `${origin}/api/assurance/v1/evaluations/labeled-data`,
      );
      if (exportOptions.from) url.searchParams.set("from", exportOptions.from);
      if (exportOptions.to) url.searchParams.set("to", exportOptions.to);
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
        redirect: "error",
      });
      return jsonResponse<AutomatedEvalLabeledDataExport>(response);
    },
    async getResult(receiptId) {
      if (!/^aer_[0-9a-f]{40}$/u.test(receiptId)) {
        throw new Error("RateLoop automated-eval receipt ID is invalid.");
      }
      const response = await fetchImpl(
        `${origin}/api/assurance/v1/evaluations/receipts/${receiptId}`,
        {
          headers: { Authorization: `Bearer ${options.apiKey}` },
          redirect: "error",
        },
      );
      return jsonResponse<AutomatedEvalResult>(response);
    },
  };
}
