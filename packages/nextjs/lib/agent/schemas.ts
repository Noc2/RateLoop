import { getProfileSelfReportTaxonomy } from "@rateloop/node-utils/profileSelfReport";
import {
  GENERATED_IMAGE_DISPLAY_GUIDANCE_SENTENCE,
  IMAGE_DISPLAY_GUIDANCE_SENTENCE,
} from "~~/lib/attachments/imageDisplayGuidance";

type JsonSchema = Record<string, unknown>;

const profileSelfReportTaxonomy = getProfileSelfReportTaxonomy();
const targetAudienceTaxonomy = profileSelfReportTaxonomy.targetAudience;

const atomicAmountSchema = {
  description: "Atomic token amount as a base-10 integer string.",
  pattern: "^\\d+$",
  type: "string",
};

const chainIdSchema = {
  description:
    "Target RateLoop deployment EVM chain id. Browser handoffs keep this saved chain during prepare; the connected wallet may need to switch to it before execution.",
  minimum: 1,
  type: "integer",
};

const evmAddressSchema = {
  description: "EVM wallet address.",
  pattern: "^0x[a-fA-F0-9]{40}$",
  type: "string",
};

const hexBytesSchema = {
  pattern: "^0x([a-fA-F0-9]{2})*$",
  type: "string",
};

const bytes32Schema = {
  pattern: "^0x[a-fA-F0-9]{64}$",
  type: "string",
};

const agentWalletAddressSchema = {
  ...evmAddressSchema,
  description:
    "User-controlled wallet or scoped agent wallet that signs the returned transaction plan or EIP-3009 USDC authorization.",
};

const templateSelectorSchema = {
  additionalProperties: false,
  properties: {
    templateId: {
      description:
        "Off-chain RateLoop result interpretation template id. Use head_to_head_ab for exactly two named alternatives in one pick-one A/B comparison; do not encode A/B choices as generic vote-up/vote-down wording.",
      type: "string",
    },
    templateInputs: {
      additionalProperties: true,
      description:
        "Template-specific off-chain inputs used only for result interpretation. For head_to_head_ab, provide optionAKey=A, optionALabel, optionBKey=B, and optionBLabel.",
      type: "object",
    },
    templateVersion: {
      description: "Template version. Defaults to the latest supported version for the template.",
      minimum: 1,
      type: "integer",
    },
  },
  type: "object",
} satisfies JsonSchema;

function enumArraySchema(values: readonly string[], description?: string) {
  const allowedValues = `Allowed values: ${values.join(", ")}.`;
  return {
    description: description ? `${description} ${allowedValues}` : allowedValues,
    items: { enum: [...values], type: "string" },
    type: "array",
  };
}

function stringArraySchema(description: string) {
  return {
    description,
    items: { type: "string" },
    type: "array",
  };
}

const targetAudienceInputSchema = {
  additionalProperties: false,
  description:
    "Optional structured self-reported audience request. Enum fields list their supported values and rateloop_list_audience_options returns the full taxonomy; do not invent aliases. Target criteria are hidden from the normal rating UI but are part of the public question metadata preimage; do not put secrets here.",
  properties: {
    ageGroups: enumArraySchema(targetAudienceTaxonomy.ageGroups),
    countries: stringArraySchema(targetAudienceTaxonomy.countries),
    expertise: enumArraySchema(targetAudienceTaxonomy.expertise),
    languages: enumArraySchema(targetAudienceTaxonomy.languages),
    nationalities: stringArraySchema(targetAudienceTaxonomy.nationalities),
    roles: enumArraySchema(targetAudienceTaxonomy.roles),
    ai: {
      additionalProperties: false,
      properties: {
        agentFrameworks: enumArraySchema(targetAudienceTaxonomy.ai.agentFrameworks),
        autonomy: enumArraySchema(targetAudienceTaxonomy.ai.autonomy),
        expertise: enumArraySchema(targetAudienceTaxonomy.ai.expertise),
        languages: enumArraySchema(targetAudienceTaxonomy.ai.languages),
        modelProviders: enumArraySchema(targetAudienceTaxonomy.ai.modelProviders),
      },
      type: "object",
    },
    team: {
      additionalProperties: false,
      properties: {
        countries: stringArraySchema(targetAudienceTaxonomy.team.countries),
        expertise: enumArraySchema(targetAudienceTaxonomy.team.expertise),
        languages: enumArraySchema(targetAudienceTaxonomy.team.languages),
        sizes: enumArraySchema(targetAudienceTaxonomy.team.sizes),
        types: enumArraySchema(targetAudienceTaxonomy.team.types),
      },
      type: "object",
    },
    hybrid: {
      additionalProperties: false,
      properties: {
        expertise: enumArraySchema(targetAudienceTaxonomy.hybrid.expertise),
        languages: enumArraySchema(targetAudienceTaxonomy.hybrid.languages),
        modelProviders: enumArraySchema(targetAudienceTaxonomy.hybrid.modelProviders),
        oversight: enumArraySchema(targetAudienceTaxonomy.hybrid.oversight),
      },
      type: "object",
    },
  },
  type: "object",
} satisfies JsonSchema;

const agentQuestionConfidentialityInputSchema = {
  additionalProperties: false,
  properties: {
    bond: {
      additionalProperties: false,
      properties: {
        amount: {
          default: "0",
          description:
            "Optional slashable confidentiality bond amount in atomic units. Use 0 for no bond; nonzero bonds must be at least 1000000 atomic units.",
          pattern: "^\\d+$",
          type: ["integer", "string"],
        },
        asset: {
          default: "LREP",
          enum: ["LREP", "lrep", "USDC", "usdc"],
          type: "string",
        },
      },
      type: ["object", "null"],
    },
    disclosurePolicy: {
      default: "private_forever",
      enum: ["after_settlement", "private_until_settlement", "private_forever"],
      type: "string",
    },
    visibility: {
      default: "public",
      enum: ["public", "gated"],
      type: "string",
    },
  },
  type: "object",
} satisfies JsonSchema;

const agentRoundPresetInputSchema = {
  description:
    "Optional named timing preset. Use pure_agent_fast for low-stakes agent-only review rounds: 60s question duration and the bounty's required voter count.",
  enum: ["pure_agent_fast", "default"],
  type: "string",
} satisfies JsonSchema;

const agentQuestionInputSchema = {
  additionalProperties: true,
  properties: {
    categoryId: { description: "RateLoop category id.", type: ["integer", "string"] },
    confidentiality: agentQuestionConfidentialityInputSchema,
    contextUrl: {
      description:
        "Optional public HTTPS page URL voters should inspect. For generated/local images in human-wallet flows, use rateloop_create_ask_handoff_link with generatedImages; for direct asks, upload bytes first and use imageUrls. Required when both imageUrls and videoUrl are empty.",
      type: "string",
    },
    detailsHash: {
      ...bytes32Schema,
      description: "SHA-256 hash of the full off-chain details text. Required when detailsUrl is provided.",
    },
    detailsUrl: {
      description:
        "Optional HTTPS URL for longer immutable question details. Provide detailsHash so front-ends can verify the fetched text.",
      type: "string",
    },
    imageUrls: {
      description: `Image URLs returned by RateLoop image upload for public mockups, screenshots, or generated visuals. External .jpg/.png/.webp URLs are rejected for direct submissions. For human-wallet local/generated images, prefer rateloop_create_ask_handoff_link with generatedImages. ${IMAGE_DISPLAY_GUIDANCE_SENTENCE}`,
      items: { type: "string" },
      type: "array",
    },
    tags: {
      description: "One to three public tags.",
      items: { type: "string" },
      maxItems: 3,
      minItems: 1,
      type: ["array", "string"],
    },
    roundPreset: agentRoundPresetInputSchema,
    targetAudience: targetAudienceInputSchema,
    title: {
      description:
        "Question title shown to voters. For A/B comparisons, use head_to_head_ab and title wording like Do you prefer A = Option A or B = Option B? rather than vote-up-if phrasing.",
      type: "string",
    },
    videoUrl: {
      description: "Optional YouTube URL. Required only when both contextUrl and imageUrls are empty.",
      type: "string",
    },
    ...templateSelectorSchema.properties,
  },
  required: ["title", "categoryId", "tags"],
  type: "object",
} satisfies JsonSchema;

const agentBountyInputSchema = {
  additionalProperties: false,
  properties: {
    amount: atomicAmountSchema,
    asset: {
      default: "USDC",
      enum: ["USDC", "usdc", "LREP", "lrep"],
      type: "string",
    },
    bountyEligibility: {
      description:
        "Bounty payout scope bitmask: 0 everyone or 8 Proof of Human. Omit to use RateLoop's launch default of 0 for everyone. Everyone can still answer; this only scopes bounty payouts.",
      enum: [0, 8, "0", "8"],
      type: ["integer", "string"],
    },
    requiredVoters: {
      description:
        "Minimum eligible voters required by the bounty. Must match roundConfig.minVoters when provided. Launch amount tiers are evaluated in the selected bounty asset's atomic units: at least 5 voters at or above 1,000,000,000 atomic units and 8 voters at or above 10,000,000,000 atomic units; governance can raise these floors for new asks as usage grows.",
      type: ["integer", "string"],
    },
  },
  required: ["amount"],
  type: "object",
} satisfies JsonSchema;

const agentFeedbackBonusInputSchema = {
  additionalProperties: false,
  properties: {
    amount: atomicAmountSchema,
    asset: {
      default: "USDC",
      enum: ["USDC", "usdc", "LREP", "lrep"],
      type: "string",
    },
    awarder: {
      ...evmAddressSchema,
      description:
        "Wallet allowed to award useful public rater feedback after settlement. Defaults to the asking wallet.",
    },
  },
  required: ["amount"],
  type: "object",
} satisfies JsonSchema;

const agentResultOperationStatusSchema = {
  description:
    "Normalized operation/result lifecycle status. Settled result packages use result_ready/not_final; pending packages use the submission lifecycle status or not_found; dry-run fixtures use dry_run.",
  enum: [
    "awaiting_wallet_signature",
    "dry_run",
    "failed",
    "not_final",
    "not_found",
    "result_ready",
    "submitted",
    "webhook_signature_required",
  ],
  type: "string",
} satisfies JsonSchema;

const agentResultProtocolStateSchema = {
  additionalProperties: true,
  properties: {
    latestRound: { type: ["object", "null"] },
    operationStatus: agentResultOperationStatusSchema,
    status: { type: ["integer", "null"] },
  },
  type: "object",
} satisfies JsonSchema;

const agentRoundConfigInputSchema = {
  additionalProperties: false,
  properties: {
    questionDurationSeconds: {
      description:
        "Single question duration in seconds. The blind response window, max round duration, bounty eligibility window, and feedback bonus close all use this value.",
      type: ["integer", "string"],
    },
    maxVoters: { description: "Maximum voters accepted by the private round.", type: ["integer", "string"] },
    minVoters: {
      description:
        "Minimum voters required before settlement. Must match bounty.requiredVoters. Three-voter rounds are the launch feedback tier; 8 revealed voters are the initial floor for full score-spread forfeiture economics, and governance can raise new-round floors over time.",
      type: ["integer", "string"],
    },
  },
  type: "object",
} satisfies JsonSchema;

export const agentOperationLookupInputSchema = {
  additionalProperties: false,
  properties: {
    chainId: { description: "Chain id used with clientRequestId lookup.", type: "integer" },
    clientRequestId: { description: "Client idempotency key returned by rateloop_ask_humans.", type: "string" },
    dryRun: {
      description: "When true, resolve deterministic dry-run fixtures returned by rateloop_ask_humans.",
      type: ["boolean", "string"],
    },
    executionMode: {
      description: "Use dry_run to resolve deterministic dry-run fixtures.",
      enum: ["dry_run"],
      type: "string",
    },
    mode: {
      description: "Use dry_run to resolve deterministic dry-run fixtures.",
      enum: ["dry_run"],
      type: "string",
    },
    operationKey: { description: "RateLoop operation key returned by quote or ask.", type: "string" },
    sandbox: {
      description: "Alias for dryRun=true when resolving deterministic dry-run fixtures.",
      type: ["boolean", "string"],
    },
    walletAddress: {
      ...agentWalletAddressSchema,
      description:
        "Required for public wallet-mode lookup by chainId and clientRequestId. Not needed when operationKey is provided.",
    },
  },
  type: "object",
} satisfies JsonSchema;

const imageAttachmentIdSchema = {
  description: "RateLoop image attachment id returned by rateloop_prepare_image_upload or rateloop_upload_image.",
  pattern: "^att_[A-Za-z0-9_-]{16,80}$",
  type: "string",
};

const imageUploadMetadataProperties = {
  attachmentId: {
    ...imageAttachmentIdSchema,
    description:
      "Optional attachment id from rateloop_prepare_image_upload. Omit it for managed-token uploads that do not need a wallet challenge.",
  },
  clientRequestId: {
    description: "Optional idempotency key to associate the upload with a later ask.",
    pattern: "^[A-Za-z0-9._:-]{4,160}$",
    type: "string",
  },
  filename: { description: "Original image filename, such as generated-mockup.png.", type: "string" },
  mimeType: {
    description: "Image MIME type. Supported values are image/jpeg, image/png, and image/webp.",
    enum: ["image/jpeg", "image/png", "image/webp"],
    type: "string",
  },
  sha256: {
    description: "Lowercase SHA-256 hash of the raw image bytes. rateloop_upload_image can compute it if omitted.",
    pattern: "^[a-f0-9]{64}$",
    type: "string",
  },
  sizeBytes: {
    description: "Raw image byte length. rateloop_upload_image can compute it if omitted.",
    minimum: 1,
    type: "integer",
  },
  walletAddress: agentWalletAddressSchema,
} satisfies JsonSchema;

export const agentPrepareImageUploadInputSchema = {
  additionalProperties: false,
  properties: imageUploadMetadataProperties,
  required: ["filename", "mimeType", "sha256", "sizeBytes"],
  type: "object",
} satisfies JsonSchema;

export const agentUploadImageInputSchema = {
  additionalProperties: false,
  properties: {
    ...imageUploadMetadataProperties,
    challengeId: {
      description: "Wallet upload challenge id returned by rateloop_prepare_image_upload for public MCP uploads.",
      type: "string",
    },
    dataUrl: {
      description:
        "Alternative to imageBase64. A data:image/png;base64,..., data:image/jpeg;base64,..., or data:image/webp;base64,... URL. Build it from file bytes in the same process that sends the request; do not copy from terminal output.",
      type: "string",
    },
    imageBase64: {
      description: `Base64-encoded raw image bytes. Use this when uploading an AI-generated mockup directly. ${GENERATED_IMAGE_DISPLAY_GUIDANCE_SENTENCE}`,
      type: "string",
    },
    signature: {
      description:
        "Wallet signature over the upload challenge message. Required for public MCP uploads; managed-token uploads may omit it.",
      pattern: "^0x([a-fA-F0-9]{2})*$",
      type: "string",
    },
  },
  required: ["filename"],
  type: "object",
} satisfies JsonSchema;

export const agentImageUploadStatusInputSchema = {
  additionalProperties: false,
  properties: {
    attachmentId: imageAttachmentIdSchema,
  },
  required: ["attachmentId"],
  type: "object",
} satisfies JsonSchema;

export const agentPrepareImageUploadOutputSchema = {
  additionalProperties: true,
  properties: {
    attachmentId: imageAttachmentIdSchema,
    authMode: { enum: ["managed_agent", "wallet_signature"], type: "string" },
    challengeId: { type: ["string", "null"] },
    expiresAt: { type: ["string", "null"] },
    maxSizeBytes: { type: "integer" },
    message: { type: ["string", "null"] },
    nextTool: { type: "string" },
    signatureRequired: { type: "boolean" },
    supportedMimeTypes: { items: { type: "string" }, type: "array" },
    walletAddress: { type: ["string", "null"] },
  },
  required: ["attachmentId", "authMode", "nextTool", "signatureRequired", "supportedMimeTypes", "maxSizeBytes"],
  type: "object",
} satisfies JsonSchema;

export const agentImageUploadOutputSchema = {
  additionalProperties: true,
  properties: {
    attachmentId: imageAttachmentIdSchema,
    error: { type: ["string", "null"] },
    height: { type: ["integer", "null"] },
    imageUrl: { type: ["string", "null"] },
    moderationStatus: { type: "string" },
    nextAction: { type: "string" },
    status: {
      enum: ["uploading", "processing", "approved", "blocked", "failed", "deleted"],
      type: "string",
    },
    width: { type: ["integer", "null"] },
  },
  required: ["attachmentId", "status", "moderationStatus", "imageUrl", "nextAction"],
  type: "object",
} satisfies JsonSchema;

const agentAskInputBaseProperties = {
  bounty: agentBountyInputSchema,
  chainId: chainIdSchema,
  clientRequestId: {
    description: "Idempotency key chosen by the agent.",
    pattern: "^[A-Za-z0-9._:-]{4,160}$",
    type: "string",
  },
  confidentiality: {
    ...agentQuestionConfidentialityInputSchema,
    description:
      "Optional default confidentiality settings for every question. Set visibility=gated for private RateLoop-hosted context.",
  },
  dryRun: {
    default: false,
    description:
      "When true, validate and return a deterministic no-payment sandbox response without wallet signatures, transaction plans, callbacks, or on-chain submission.",
    type: "boolean",
  },
  executionMode: {
    description: "Use dry_run as an alias for dryRun=true.",
    enum: ["dry_run"],
    type: "string",
  },
  sandbox: {
    description: "Alias for dryRun=true.",
    type: ["boolean", "string"],
  },
  question: agentQuestionInputSchema,
  questions: {
    description: "Ordered bundle of question payloads. The bounty pays only when every question is answered.",
    items: agentQuestionInputSchema,
    type: "array",
  },
  feedbackBonus: {
    ...agentFeedbackBonusInputSchema,
    description:
      "Optional LREP or USDC pool for useful public feedback from revealed raters on single-question asks. Wallet-call asks can fund LREP or USDC bounties with either LREP or USDC Feedback Bonuses; eip3009_usdc_authorization/x402_authorization can fund only USDC bounty plus USDC Feedback Bonus in one submit transaction.",
  },
  roundConfig: agentRoundConfigInputSchema,
  roundPreset: agentRoundPresetInputSchema,
  ...templateSelectorSchema.properties,
} satisfies JsonSchema;

const agentHandoffGeneratedImageInputSchema = {
  additionalProperties: false,
  properties: {
    dataUrl: {
      description:
        "Alternative to imageBase64. A data:image/png;base64,..., data:image/jpeg;base64,..., or data:image/webp;base64,... URL.",
      type: "string",
    },
    filename: { description: "Generated or local image filename, such as generated-mockup.png.", type: "string" },
    imageBase64: {
      description: `Base64-encoded raw image bytes staged for browser wallet upload. Use the original under-10 MB JPG, PNG, or WEBP and read bytes directly from disk or memory; do not shrink images because a chat or terminal display capped base64 output. ${GENERATED_IMAGE_DISPLAY_GUIDANCE_SENTENCE}`,
      type: "string",
    },
    mimeType: {
      description: "Image MIME type. Supported values are image/jpeg, image/png, and image/webp.",
      enum: ["image/jpeg", "image/png", "image/webp"],
      type: "string",
    },
    sha256: {
      description: "Optional lowercase SHA-256 hash of the raw image bytes.",
      pattern: "^[a-f0-9]{64}$",
      type: "string",
    },
    sizeBytes: {
      description: "Optional raw image byte length computed from the exact decoded image buffer.",
      minimum: 1,
      type: "integer",
    },
  },
  required: ["filename"],
  type: "object",
} satisfies JsonSchema;

const agentAskHandoffRequestProperties = {
  ...agentAskInputBaseProperties,
  maxPaymentAmount: {
    description:
      "Maximum bounty payment spend in atomic units for the selected funding mode. For same-asset Feedback Bonuses, include the bonus amount too; mixed-asset wallet-call Feedback Bonuses are confirmed through a separate wallet plan. EIP-3009/x402 payments are USDC-only.",
    pattern: "^\\d+$",
    type: "string",
  },
  paymentMode: {
    default: "eip3009_usdc_authorization",
    description:
      "Browser handoffs auto-prefer EIP-3009 USDC authorization for eligible single-question USDC asks so the user signs a USDC authorization and submits one transaction. Use wallet_calls for LREP bounties, bundled asks, hosts that want raw wallet calls, or any Feedback Bonus funding outside the USDC one-shot path. EIP-3009/x402 can only one-shot USDC bounty plus USDC Feedback Bonus.",
    enum: ["wallet_calls", "eip3009_usdc_authorization", "x402_authorization"],
    type: "string",
  },
  walletAddress: {
    ...agentWalletAddressSchema,
    description: "Optional expected user wallet. If omitted, the user chooses the wallet in the browser handoff.",
  },
} satisfies JsonSchema;

const agentAskHandoffRequestSchema = {
  additionalProperties: true,
  properties: agentAskHandoffRequestProperties,
  required: ["clientRequestId", "bounty", "maxPaymentAmount"],
  type: "object",
} satisfies JsonSchema;

export const agentCreateAskHandoffInputSchema = {
  additionalProperties: true,
  anyOf: [{ required: ["request"] }, { required: ["clientRequestId", "bounty", "maxPaymentAmount"] }],
  description:
    "Create a browser handoff ask. If the ask compares exactly two named options, set question.templateId to head_to_head_ab and fill question.templateInputs optionAKey=A, optionALabel, optionBKey=B, and optionBLabel so the browser opens in A/B comparison mode.",
  properties: {
    ...agentAskHandoffRequestProperties,
    generatedImages: {
      description: `Optional generated/local image bytes to stage into the browser handoff. Uses the same JPG, PNG, and WEBP limit as the submit page: 10 MB per image, with the MCP JSON body limit applying to the aggregate base64 request. RateLoop fully decodes these bytes before returning a link, so corrupt or truncated images are rejected synchronously. Use this instead of raw public image-upload challenges for normal chat flows, and pass bytes from file-backed tooling such as rateloop-agents handoff --file ask.json --image mockup.png rather than copied terminal output. ${GENERATED_IMAGE_DISPLAY_GUIDANCE_SENTENCE}`,
      items: agentHandoffGeneratedImageInputSchema,
      maxItems: 4,
      type: "array",
    },
    request: {
      ...agentAskHandoffRequestSchema,
      description:
        "Optional wrapped ask request body. When present, RateLoop stages generatedImages alongside this request.",
    },
    ttlMs: {
      description:
        "Optional handoff link lifetime in milliseconds. Defaults to 30 minutes; minimum 60000, maximum 1800000.",
      maximum: 1_800_000,
      minimum: 60000,
      type: "integer",
    },
  },
  type: "object",
} satisfies JsonSchema;

export const agentHandoffStatusInputSchema = {
  additionalProperties: false,
  properties: {
    handoffId: {
      description: "Agent ask handoff id returned by rateloop_create_ask_handoff_link.",
      type: "string",
    },
    handoffToken: {
      description: "Private handoff token returned by rateloop_create_ask_handoff_link.",
      type: "string",
    },
    includeImageData: {
      description:
        "When true, include dataUrl base64 for stored staged images. Defaults to metadata-only for routine polling.",
      type: ["boolean", "string"],
    },
  },
  required: ["handoffId", "handoffToken"],
  type: "object",
} satisfies JsonSchema;

export const agentAskHandoffOutputSchema = {
  additionalProperties: true,
  properties: {
    assets: { items: { type: "object" }, type: "array" },
    chainId: { type: ["integer", "null"] },
    clientRequestId: { type: "string" },
    completedAt: { type: ["string", "null"] },
    createdAt: { type: "string" },
    draftRevision: {
      description: "Current editable draft revision. Increments when the browser user saves changes before prepare.",
      type: "integer",
    },
    editedByUser: {
      description: "True when the browser user changed the agent-created draft before preparing the ask.",
      type: "boolean",
    },
    error: {
      description: "Top-level handoff failure, or null when no handoff-level error has occurred.",
      type: ["string", "null"],
    },
    expiresAt: { type: "string" },
    feedbackBonusError: {
      description: "Feedback Bonus confirmation failure, or null when no bonus confirmation error is pending.",
      type: ["string", "null"],
    },
    feedbackBonusStatus: {
      enum: ["pending_confirmation", "failed_confirmation", "confirmed", null],
      type: ["string", "null"],
    },
    feedbackBonusTransactionHashes: { items: { type: "string" }, type: "array" },
    handoffId: { type: "string" },
    handoffToken: { type: "string" },
    handoffUrl: { type: "string" },
    id: { type: "string" },
    nextAction: { type: "string" },
    operationKey: { type: ["string", "null"] },
    payloadHash: { type: ["string", "null"] },
    paymentMode: { enum: ["wallet_calls", "x402_authorization"], type: "string" },
    paymentModeDiagnostics: {
      additionalProperties: false,
      properties: {
        awaitingX402Authorization: { type: "boolean" },
        mode: { enum: ["wallet_calls", "x402_authorization"], type: "string" },
        transactionCallCount: { type: "number" },
      },
      required: ["awaitingX402Authorization", "mode", "transactionCallCount"],
      type: "object",
    },
    originalRequestBody: {
      additionalProperties: true,
      description: "The immutable ask request originally created by the agent.",
      type: "object",
    },
    preparedDraftRevision: {
      description: "Draft revision used to build the current transaction plan, or null before prepare.",
      type: ["integer", "null"],
    },
    requestBody: {
      additionalProperties: true,
      description: "The current browser-reviewed ask request body that prepare/submit will use.",
      type: "object",
    },
    resultTool: { type: "string" },
    status: { type: "string" },
    statusTool: { type: "string" },
    transactionHashes: { items: { type: "string" }, type: "array" },
    transactionPlan: { type: ["object", "null"] },
    updatedAt: { type: "string" },
    walletAddress: { type: ["string", "null"] },
  },
  required: ["status"],
  type: "object",
} satisfies JsonSchema;

const agentAskHandoffCreateOnlyFields = new Set([
  "handoffId",
  "handoffToken",
  "handoffUrl",
  "resultTool",
  "statusTool",
]);
const agentAskHandoffStatusOutputProperties = Object.fromEntries(
  Object.entries(agentAskHandoffOutputSchema.properties).filter(([key]) => !agentAskHandoffCreateOnlyFields.has(key)),
);

export const agentAskHandoffStatusOutputSchema = {
  additionalProperties: true,
  properties: agentAskHandoffStatusOutputProperties,
  required: ["status"],
  type: "object",
} satisfies JsonSchema;

export const agentQuoteInputSchema = {
  additionalProperties: true,
  description:
    "Preflight an ask using public URLs or already uploaded RateLoop imageUrls. generatedImages are validated by rateloop_create_ask_handoff_link, not by quote; for generated-image-only handoffs, create the handoff directly and let the browser prepare step price the ask before payment.",
  properties: {
    ...agentAskInputBaseProperties,
    walletAddress: {
      ...agentWalletAddressSchema,
      description:
        "Required for public wallet-mode quotes. Managed MCP agents may omit it when the token has a scoped wallet.",
    },
  },
  required: ["clientRequestId", "bounty"],
  type: "object",
} satisfies JsonSchema;

export const agentAskHumansInputSchema = {
  additionalProperties: true,
  anyOf: [
    { required: ["clientRequestId", "bounty", "maxPaymentAmount"] },
    { required: ["clientRequestId", "bounty", "dryRun"] },
    { required: ["clientRequestId", "bounty", "executionMode"] },
    { required: ["clientRequestId", "bounty", "mode"] },
    { required: ["clientRequestId", "bounty", "sandbox"] },
  ],
  properties: {
    ...agentAskInputBaseProperties,
    maxPaymentAmount: {
      description:
        "Maximum bounty payment spend in atomic units for the selected funding mode. For same-asset Feedback Bonuses, include the bonus amount too; mixed-asset wallet-call Feedback Bonuses are confirmed through a separate wallet plan. EIP-3009/x402 payments are USDC-only.",
      pattern: "^\\d+$",
      type: "string",
    },
    mode: {
      description: "Omit for live asks. Use dry_run for a no-payment sandbox response.",
      enum: ["dry_run"],
      type: "string",
    },
    paymentAuthorization: {
      additionalProperties: false,
      description:
        "Signed EIP-3009 ReceiveWithAuthorization payload for paymentMode=eip3009_usdc_authorization or the legacy x402_authorization alias. Omit signature on the first call to receive the authorization request.",
      properties: {
        from: evmAddressSchema,
        nonce: { pattern: "^0x[a-fA-F0-9]{64}$", type: "string" },
        signature: { pattern: "^0x([a-fA-F0-9]{2})*$", type: "string" },
        to: evmAddressSchema,
        validAfter: atomicAmountSchema,
        validBefore: atomicAmountSchema,
        value: atomicAmountSchema,
      },
      type: "object",
    },
    paymentMode: {
      default: "eip3009_usdc_authorization",
      description:
        "Eligible single-question USDC asks default to eip3009_usdc_authorization so the wallet signs a USDC authorization and submits one transaction. wallet_calls returns approve/reserve/submit transactions and is required for LREP bounties, bundled asks, hosts that need raw calls, or any Feedback Bonus funding outside the USDC one-shot path. EIP-3009/x402 can only one-shot USDC bounty plus USDC Feedback Bonus. x402_authorization is accepted as a legacy compatibility alias.",
      enum: ["wallet_calls", "eip3009_usdc_authorization", "x402_authorization"],
      type: "string",
    },
    walletAddress: agentWalletAddressSchema,
    webhookUrl: {
      description: "Optional HTTPS callback URL for lifecycle events.",
      type: "string",
    },
    webhookEvents: {
      description: "Optional lifecycle event names to deliver to webhookUrl.",
      items: { type: "string" },
      type: "array",
    },
    webhookSecret: {
      description: "Shared HMAC secret used to sign callback deliveries.",
      type: "string",
    },
    webhookChallengeId: {
      description: "Public wallet webhook challenge id returned by the previous webhook_signature_required response.",
      type: "string",
    },
    webhookSignature: {
      description: "Wallet signature for webhookChallengeId. Required for tokenless public webhook registration.",
      pattern: "^0x([a-fA-F0-9]{2})*$",
      type: "string",
    },
  },
  type: "object",
} satisfies JsonSchema;

export const agentConfirmAskTransactionsInputSchema = {
  additionalProperties: false,
  properties: {
    operationKey: { description: "RateLoop operation key returned by rateloop_ask_humans.", type: "string" },
    transactionHashes: {
      description: "Transaction hashes produced by executing the wallet transaction plan.",
      items: { pattern: "^0x[a-fA-F0-9]{64}$", type: "string" },
      maxItems: 32,
      minItems: 1,
      type: "array",
    },
  },
  required: ["operationKey", "transactionHashes"],
  type: "object",
} satisfies JsonSchema;

export const agentConfirmFeedbackBonusTransactionsInputSchema = {
  additionalProperties: false,
  properties: {
    operationKey: { description: "RateLoop operation key returned by rateloop_ask_humans.", type: "string" },
    transactionHashes: {
      description: "Transaction hashes produced by executing the Feedback Bonus wallet transaction plan.",
      items: { pattern: "^0x[a-fA-F0-9]{64}$", type: "string" },
      maxItems: 8,
      minItems: 1,
      type: "array",
    },
  },
  required: ["operationKey", "transactionHashes"],
  type: "object",
} satisfies JsonSchema;

export const agentRatingContextInputSchema = {
  additionalProperties: false,
  properties: {
    chainId: chainIdSchema,
    contentId: { description: "RateLoop content id to rate.", type: ["integer", "string"] },
    stakeWei: {
      description: "Optional LREP stake in atomic units; when supplied the response includes current allowance.",
      pattern: "^\\d+$",
      type: "string",
    },
    walletAddress: agentWalletAddressSchema,
  },
  required: ["contentId"],
  type: "object",
} satisfies JsonSchema;

export const agentAcceptConfidentialityTermsInputSchema = {
  additionalProperties: false,
  properties: {
    chainId: chainIdSchema,
    contentId: {
      description: "RateLoop gated content id whose context terms are being accepted.",
      type: ["integer", "string"],
    },
    challengeId: {
      description:
        "Server-issued confidentiality terms challenge id returned by the first rateloop_accept_confidentiality_terms call.",
      type: "string",
    },
    signature: {
      description:
        "Wallet signature over the server-issued confidentiality terms challenge. Omit signature and challengeId on the first call to receive a challenge.",
      type: "string",
    },
    termsVersion: {
      default: "2026-06",
      description: "Confidentiality terms version to acknowledge.",
      type: "string",
    },
    walletAddress: agentWalletAddressSchema,
  },
  required: ["contentId"],
  type: "object",
} satisfies JsonSchema;

export const agentAcceptConfidentialityTermsOutputSchema = {
  additionalProperties: true,
  properties: {
    accepted: { type: "boolean" },
    challengeId: { type: ["string", "null"] },
    contentId: { type: "string" },
    contextAccess: { enum: ["public", "gated"], type: "string" },
    expiresAt: { type: ["string", "null"] },
    gatedContext: { type: ["object", "null"] },
    message: { type: ["string", "null"] },
    nextAction: { type: "string" },
    signatureRequired: { type: "boolean" },
    signedReadSession: { type: ["object", "null"] },
    status: {
      enum: ["accepted", "not_required", "signature_required"],
      type: "string",
    },
    termsDocHash: { type: "string" },
    termsUri: { type: "string" },
    termsVersion: { type: "string" },
    wallet: { type: "object" },
  },
  required: ["status", "accepted", "contentId", "contextAccess", "wallet"],
  type: "object",
} satisfies JsonSchema;

export const agentPrepareRatingTransactionsInputSchema = {
  additionalProperties: false,
  properties: {
    chainId: chainIdSchema,
    ciphertext: {
      ...hexBytesSchema,
      description:
        "Tlock-encrypted vote payload produced locally by @rateloop/sdk/vote. Do not send plaintext vote fields.",
    },
    commitHash: {
      ...bytes32Schema,
      description: "Commit hash produced locally by @rateloop/sdk/vote.",
    },
    contentId: { description: "RateLoop content id to rate.", type: ["integer", "string"] },
    drandChainHash: {
      ...bytes32Schema,
      description: "Drand chain hash bound into the local commit.",
    },
    frontend: {
      ...evmAddressSchema,
      description: "Frontend attribution code/address to pass to commitVote.",
    },
    roundId: { description: "Open round id returned by rateloop_get_rating_context.", type: ["integer", "string"] },
    roundReferenceRatingBps: {
      description: "Round reference rating returned by rateloop_get_rating_context.",
      maximum: 10000,
      minimum: 0,
      type: "integer",
    },
    stakeWei: {
      description: "LREP stake in atomic units. Use 0 for zero-stake advisory votes.",
      pattern: "^\\d+$",
      type: "string",
    },
    targetRound: {
      description: "Drand round targeted by the local tlock ciphertext.",
      type: ["integer", "string"],
    },
    walletAddress: agentWalletAddressSchema,
  },
  required: [
    "contentId",
    "roundId",
    "roundReferenceRatingBps",
    "targetRound",
    "drandChainHash",
    "commitHash",
    "ciphertext",
    "stakeWei",
    "frontend",
  ],
  type: "object",
} satisfies JsonSchema;

export const agentConfirmRatingTransactionsInputSchema = {
  additionalProperties: false,
  properties: {
    chainId: chainIdSchema,
    commitHash: {
      ...bytes32Schema,
      description: "Optional commit hash expected in the vote transaction receipt.",
    },
    contentId: { description: "RateLoop content id that was rated.", type: ["integer", "string"] },
    roundId: { description: "Round id that was rated.", type: ["integer", "string"] },
    transactionHashes: {
      description: "Transaction hashes produced by executing the rating transaction plan.",
      items: { pattern: "^0x[a-fA-F0-9]{64}$", type: "string" },
      minItems: 1,
      type: "array",
    },
    walletAddress: agentWalletAddressSchema,
  },
  required: ["contentId", "transactionHashes"],
  type: "object",
} satisfies JsonSchema;

export const agentRatingStatusInputSchema = {
  additionalProperties: false,
  properties: {
    chainId: chainIdSchema,
    contentId: { description: "RateLoop content id that was rated.", type: ["integer", "string"] },
    roundId: { description: "Optional round id to inspect.", type: ["integer", "string"] },
    walletAddress: agentWalletAddressSchema,
  },
  required: ["contentId"],
  type: "object",
} satisfies JsonSchema;

export const templateListOutputSchema = {
  additionalProperties: false,
  properties: {
    templates: {
      items: {
        additionalProperties: true,
        properties: {
          description: { type: "string" },
          id: { type: "string" },
          interpretation: { type: "object" },
          bundleStrategy: { enum: ["independent", "rank_by_rating"], type: "string" },
          ratingSystem: { type: "string" },
          recommendedUse: { items: { type: "string" }, type: "array" },
          resultSpecHash: { type: "string" },
          submissionPattern: { enum: ["bundle_member", "single_question"], type: "string" },
          templateInputsExample: {
            additionalProperties: true,
            type: ["array", "boolean", "null", "number", "object", "string"],
          },
          templateInputsSchema: { type: "object" },
          title: { type: "string" },
          version: { type: "integer" },
          voteSemantics: { type: "object" },
        },
        required: [
          "id",
          "version",
          "ratingSystem",
          "interpretation",
          "resultSpecHash",
          "submissionPattern",
          "bundleStrategy",
          "templateInputsSchema",
        ],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["templates"],
  type: "object",
} satisfies JsonSchema;

export const audienceOptionsOutputSchema = {
  additionalProperties: false,
  properties: {
    caveat: { const: profileSelfReportTaxonomy.caveat, type: "string" },
    selfReportSchemaVersion: { type: "integer" },
    source: { const: profileSelfReportTaxonomy.source, type: "string" },
    targetAudience: {
      additionalProperties: true,
      description:
        "Structured audience vocabulary. Array fields list exact allowed values; country-code fields describe ISO-3166 alpha-2 inputs.",
      type: "object",
    },
  },
  required: ["caveat", "selfReportSchemaVersion", "source", "targetAudience"],
  type: "object",
} satisfies JsonSchema;

const agentPaymentOutputSchema = {
  additionalProperties: false,
  properties: {
    amount: atomicAmountSchema,
    asset: { type: "string" },
    bountyAmount: atomicAmountSchema,
    decimals: { type: "integer" },
    spender: { type: "string" },
    tokenAddress: { type: "string" },
  },
  type: "object",
} satisfies JsonSchema;

const agentLegalNoticeOutputSchema = {
  additionalProperties: false,
  properties: {
    acceptance: { type: "string" },
    notice: { type: "string" },
    privacyUrl: { type: "string" },
    termsUrl: { type: "string" },
  },
  required: ["acceptance", "notice", "privacyUrl", "termsUrl"],
  type: "object",
} satisfies JsonSchema;

export const agentQuoteOutputSchema = {
  additionalProperties: true,
  properties: {
    canSubmit: { type: "boolean" },
    clientRequestId: { type: "string" },
    fastLane: { type: "object" },
    legalNotice: agentLegalNoticeOutputSchema,
    operationKey: { type: "string" },
    payment: agentPaymentOutputSchema,
    dryRun: { type: "boolean" },
    executionMode: { enum: ["dry_run"], type: "string" },
    paymentRequired: { type: "boolean" },
    payloadHash: { type: "string" },
    questionCount: { type: "integer" },
    resolvedCategoryIds: { items: { type: "string" }, type: "array" },
    walletPolicyRequired: { type: "boolean" },
  },
  required: ["canSubmit", "operationKey", "payment", "payloadHash", "questionCount", "resolvedCategoryIds"],
  type: "object",
} satisfies JsonSchema;

export const agentQuestionStatusOutputSchema = {
  additionalProperties: true,
  properties: {
    bundleId: { type: ["string", "null"] },
    callbackDeliveries: {
      items: {
        additionalProperties: false,
        properties: {
          attemptCount: { type: "integer" },
          callbackUrl: { type: "string" },
          deliveredAt: { type: ["string", "null"] },
          eventId: { type: "string" },
          eventType: { type: "string" },
          lastError: { type: ["string", "null"] },
          nextAttemptAt: { type: "string" },
          status: { enum: ["dead", "delivered", "delivering", "pending", "retrying"], type: "string" },
          subscriptionId: { type: "string" },
        },
        required: ["eventId", "eventType", "status", "attemptCount", "callbackUrl", "nextAttemptAt", "subscriptionId"],
        type: "object",
      },
      type: "array",
    },
    chainId: { type: "integer" },
    clientRequestId: { type: "string" },
    contentId: { type: ["string", "null"] },
    contentIds: { items: { type: "string" }, type: "array" },
    error: { type: ["string", "null"] },
    dryRun: { type: "boolean" },
    executionMode: { enum: ["dry_run"], type: "string" },
    feedbackBonus: { type: "object" },
    operationKey: { type: "string" },
    nextAction: {
      description:
        "Recommended next status action. Question status responses use call_rateloop_get_result, poll_rateloop_get_question_status, or manual_review.",
      type: "string",
    },
    payloadHash: { type: "string" },
    payment: agentPaymentOutputSchema,
    pollAfterMs: { type: ["integer", "null"] },
    publicUrl: { type: ["string", "null"] },
    questionCount: { type: "integer" },
    ready: { type: "boolean" },
    liveAskGuidance: { type: ["object", "null"] },
    rewardPoolId: { type: ["string", "null"] },
    resultTool: { type: ["string", "null"] },
    status: {
      enum: ["not_found", "awaiting_wallet_signature", "submitted", "failed", "dry_run", "webhook_signature_required"],
      type: "string",
    },
    terminal: { type: "boolean" },
    transactionHashes: { items: { type: "string" }, type: "array" },
    updatedAt: { type: "string" },
  },
  required: ["status"],
  type: "object",
} satisfies JsonSchema;

export const agentAskHumansOutputSchema = {
  additionalProperties: true,
  properties: {
    ...agentQuestionStatusOutputSchema.properties,
    bounty: { type: "object" },
    fastLane: { type: "object" },
    feedbackBonus: { type: "object" },
    legalNotice: agentLegalNoticeOutputSchema,
    managedBudget: { type: ["object", "null"] },
    pollAfterMs: { type: ["integer", "null"] },
    statusTool: { type: "string" },
    transactionPlan: { type: ["object", "null"] },
    wallet: { type: "object" },
    paymentMode: { enum: ["wallet_calls", "x402_authorization"], type: "string" },
    paymentScheme: { enum: ["wallet_calls", "eip3009_usdc_authorization"], type: "string" },
    warnings: { items: { type: "string" }, type: "array" },
    x402AuthorizationRequest: { type: ["object", "null"] },
  },
  required: ["status", "operationKey"],
  type: "object",
} satisfies JsonSchema;

const ratingTransactionPlanOutputSchema = {
  additionalProperties: true,
  properties: {
    calls: {
      items: {
        additionalProperties: true,
        properties: {
          data: hexBytesSchema,
          description: { type: "string" },
          functionName: { type: "string" },
          id: { type: "string" },
          phase: { type: "string" },
          to: evmAddressSchema,
          value: { type: "string" },
        },
        required: ["id", "to", "data", "functionName", "phase"],
        type: "object",
      },
      type: "array",
    },
    requiresAtomicExecution: { type: "boolean" },
    requiresOrderedExecution: { type: "boolean" },
  },
  required: ["calls", "requiresOrderedExecution"],
  type: "object",
} satisfies JsonSchema;

export const agentRatingContextOutputSchema = {
  additionalProperties: true,
  properties: {
    chainId: { type: "integer" },
    content: { type: "object" },
    contracts: { type: "object" },
    currentAllowance: atomicAmountSchema,
    openRoundTransactionPlan: { type: ["object", "null"] },
    privacy: { type: "object" },
    ratingInputMode: { enum: ["local_encrypted_commit"], type: "string" },
    runtime: { type: "object" },
    status: {
      enum: ["ready", "open_round_required"],
      type: "string",
    },
    wallet: { type: "object" },
  },
  required: ["status", "chainId", "content", "contracts", "runtime", "wallet", "ratingInputMode", "privacy"],
  type: "object",
} satisfies JsonSchema;

export const agentPrepareRatingTransactionsOutputSchema = {
  additionalProperties: true,
  properties: {
    chainId: { type: "integer" },
    confirmTool: { type: "string" },
    contentId: { type: "string" },
    isAdvisoryVote: { type: "boolean" },
    privacy: { type: "object" },
    publicUrl: { type: ["string", "null"] },
    roundId: { type: "string" },
    stakeWei: atomicAmountSchema,
    status: {
      enum: ["awaiting_wallet_signature"],
      type: "string",
    },
    statusTool: { type: "string" },
    transactionPlan: ratingTransactionPlanOutputSchema,
    wallet: { type: "object" },
  },
  required: ["status", "contentId", "roundId", "wallet", "transactionPlan", "confirmTool", "statusTool"],
  type: "object",
} satisfies JsonSchema;

export const agentRatingStatusOutputSchema = {
  additionalProperties: true,
  properties: {
    chainId: { type: "integer" },
    commitHash: { type: ["string", "null"] },
    confirmed: { type: "boolean" },
    contentId: { type: "string" },
    publicUrl: { type: ["string", "null"] },
    roundId: { type: ["string", "null"] },
    status: {
      enum: ["not_found", "awaiting_reveal", "committed", "revealed"],
      type: "string",
    },
    transactionHashes: { items: { type: "string" }, type: "array" },
    wallet: { type: "object" },
  },
  required: ["status", "contentId", "wallet"],
  type: "object",
} satisfies JsonSchema;

export const resultPackageOutputSchema = {
  additionalProperties: true,
  properties: {
    answer: {
      description: 'Template-specific answer string. Dry-run fixtures use the sentinel value "dry_run_complete".',
      type: "string",
    },
    answerScopes: { type: "object" },
    cohortSummary: { type: ["object", "null"] },
    targetAudienceMatch: { type: ["object", "null"] },
    confidence: {
      additionalProperties: false,
      properties: {
        level: { enum: ["none", "low", "medium", "high"], type: "string" },
        score: { type: "number" },
      },
      required: ["level", "score"],
      type: "object",
    },
    distribution: { type: "object" },
    dissentingView: { type: ["string", "null"] },
    blockedReason: {
      enum: [
        "round_not_closed",
        "normal_payout_finality",
        "payout_finality_sla_exceeded",
        "non_terminal_round_state",
        null,
      ],
    },
    estimatedReadyAt: {
      description: "Unix timestamp in seconds when normal one-hour finality is expected, when known.",
      type: ["string", "null"],
    },
    featureTest: { type: ["object", "null"] },
    finalityStatus: {
      enum: ["final", "waiting_for_round_close", "normal_finality", "stalled", "not_final"],
      type: "string",
    },
    feedbackQuality: { type: "object" },
    includesVetoWindow: { type: "boolean" },
    liveAskGuidance: { type: ["object", "null"] },
    limitations: { items: { type: "string" }, type: "array" },
    majorObjections: { items: { type: "object" }, type: "array" },
    methodology: { type: "object" },
    normalMaxDelaySeconds: { const: 3600, type: "number" },
    operation: { type: ["object", "null"] },
    protocolState: agentResultProtocolStateSchema,
    publicUrl: { type: ["string", "null"] },
    rationaleSummary: { type: "string" },
    ready: { type: "boolean" },
    recommendedNextAction: {
      description: 'Recommended agent action. Dry-run fixtures use the sentinel value "integration_ready".',
      enum: [
        "wait_for_settlement",
        "proceed",
        "proceed_after_addressing_objections",
        "revise_and_resubmit",
        "do_not_proceed",
        "collect_more_votes",
        "manual_review",
        "verify_operation_identifiers",
        "integration_ready",
      ],
      type: "string",
    },
    wait: {
      additionalProperties: true,
      properties: {
        code: {
          description: 'Synthetic wait/result code. Dry-run fixtures use "dry_run_complete".',
          enum: ["dry_run_complete", "failed_submission", "operation_not_found", "still_settling"],
          type: "string",
        },
        recoverWith: { type: ["string", "null"] },
      },
      type: "object",
    },
    sourceUrls: { items: { type: "string" }, type: "array" },
    stakeMass: { type: "object" },
    stalled: { type: "boolean" },
    voteCount: { type: "number" },
  },
  required: [
    "ready",
    "answer",
    "answerScopes",
    "cohortSummary",
    "targetAudienceMatch",
    "confidence",
    "blockedReason",
    "distribution",
    "estimatedReadyAt",
    "finalityStatus",
    "includesVetoWindow",
    "voteCount",
    "stakeMass",
    "rationaleSummary",
    "majorObjections",
    "featureTest",
    "dissentingView",
    "feedbackQuality",
    "liveAskGuidance",
    "recommendedNextAction",
    "publicUrl",
    "sourceUrls",
    "methodology",
    "normalMaxDelaySeconds",
    "stalled",
    "limitations",
  ],
  type: "object",
} satisfies JsonSchema;

export const agentBalanceOutputSchema = {
  additionalProperties: true,
  properties: {
    agentId: { type: "string" },
    dailyBudgetAtomic: atomicAmountSchema,
    perAskLimitAtomic: atomicAmountSchema,
    remainingDailyBudgetAtomic: atomicAmountSchema,
    spentTodayAtomic: atomicAmountSchema,
  },
  required: ["agentId", "dailyBudgetAtomic", "perAskLimitAtomic", "remainingDailyBudgetAtomic", "spentTodayAtomic"],
  type: "object",
} satisfies JsonSchema;
