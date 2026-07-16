import { createHash } from "node:crypto";
import {
  type AutomatedEvalClient,
  type AutomatedEvalIngestResult,
  type AutomatedEvalReceipt,
  createAutomatedEvalClient,
} from "./automatedEval";

type PromptfooProviderOptions = {
  id?: string;
  config?: {
    baseUrl?: string;
    apiKey?: string;
    apiKeyEnv?: string;
    allowInsecureLocalhost?: boolean;
    client?: AutomatedEvalClient;
  };
};

type PromptfooResponse = {
  output: string;
  metadata: {
    rateloop: {
      receiptId: string;
      automatedOutcome: AutomatedEvalIngestResult["automatedSignal"]["outcome"];
      humanReviewRequired: boolean;
      opportunityId: string | null;
      humanVerdict: null;
    };
  };
};

function configuredClient(options: PromptfooProviderOptions) {
  if (options.config?.client) return options.config.client;
  const envName = options.config?.apiKeyEnv ?? "RATELOOP_API_KEY";
  const apiKey = options.config?.apiKey ?? process.env[envName];
  if (!apiKey)
    throw new Error(
      `RateLoop Promptfoo provider requires config.apiKey or ${envName}.`,
    );
  return createAutomatedEvalClient({
    baseUrl: options.config?.baseUrl ?? "https://rateloop-tokenless.vercel.app",
    apiKey,
    allowInsecureLocalhost: options.config?.allowInsecureLocalhost,
  });
}

/**
 * Promptfoo custom JavaScript provider. The rendered prompt must be a JSON
 * AutomatedEvalReceipt containing commitments and evaluation metadata only.
 * It never accepts or returns a human verdict.
 */
export class RateLoopPromptfooProvider {
  private readonly providerId: string;
  private readonly client: AutomatedEvalClient;

  constructor(options: PromptfooProviderOptions = {}) {
    this.providerId = options.id ?? "rateloop:automated-eval-escalation";
    this.client = configuredClient(options);
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt: string): Promise<PromptfooResponse> {
    let receipt: AutomatedEvalReceipt;
    try {
      receipt = JSON.parse(prompt) as AutomatedEvalReceipt;
    } catch {
      throw new Error(
        "RateLoop Promptfoo provider requires a JSON automated-eval receipt, not raw prompt content.",
      );
    }
    if (
      !receipt ||
      receipt.schemaVersion !== "rateloop.automated-eval-receipt.v1"
    ) {
      throw new Error(
        "RateLoop Promptfoo provider received an unsupported receipt schema.",
      );
    }
    const result = await this.client.ingest(receipt, {
      idempotencyKey: `promptfoo:${createHash("sha256")
        .update(`${receipt.externalReceiptId}\0${receipt.evaluation.checkName}`)
        .digest("hex")}`,
    });
    const projected = {
      receiptId: result.receiptId,
      automatedOutcome: result.automatedSignal.outcome,
      humanReviewRequired: result.humanReview?.required ?? false,
      opportunityId: result.humanReview?.opportunityId ?? null,
      humanVerdict: null,
    } as const;
    return {
      output: JSON.stringify(projected),
      metadata: { rateloop: projected },
    };
  }
}

type PromptfooAssertionContext = {
  providerResponse?: {
    metadata?: { rateloop?: PromptfooResponse["metadata"]["rateloop"] };
  };
  metadata?: { rateloop?: PromptfooResponse["metadata"]["rateloop"] };
};

/** Promptfoo custom assertion for a RateLoop provider response. */
export function rateLoopPromptfooAssertion(
  _output: string,
  context: PromptfooAssertionContext,
) {
  const result =
    context.metadata?.rateloop ?? context.providerResponse?.metadata?.rateloop;
  if (!result)
    return {
      pass: false,
      score: 0,
      reason: "RateLoop receipt metadata is missing.",
    };
  if (result.humanVerdict !== null) {
    return {
      pass: false,
      score: 0,
      reason: "Automated evaluation cannot provide a human verdict.",
    };
  }
  if (result.automatedOutcome === "uncertain") {
    return {
      pass: false,
      score: 0,
      reason: result.humanReviewRequired
        ? `Automated evaluation is uncertain; human review is required (${result.opportunityId}).`
        : "Automated evaluation is uncertain but no human review was created.",
    };
  }
  return {
    pass: result.automatedOutcome === "pass",
    score: result.automatedOutcome === "pass" ? 1 : 0,
    reason: `Automated evaluation reported ${result.automatedOutcome}; this is not a human verdict.`,
  };
}

export default RateLoopPromptfooProvider;
