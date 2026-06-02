type JsonSchema = Record<string, unknown>;

const atomicAmountSchema = {
  description: "Atomic USDC amount as a base-10 integer string.",
  pattern: "^\\d+$",
  type: "string",
};

const chainIdSchema = {
  description: "EVM chain id.",
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
    "User-controlled wallet or scoped agent wallet that signs the returned transaction plan or x402 authorization.",
};

const templateSelectorSchema = {
  additionalProperties: false,
  properties: {
    templateId: {
      description: "Off-chain RateLoop result interpretation template id.",
      type: "string",
    },
    templateInputs: {
      additionalProperties: true,
      description: "Template-specific off-chain inputs used only for result interpretation.",
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

const agentQuestionInputSchema = {
  additionalProperties: true,
  properties: {
    categoryId: { description: "RateLoop category id.", type: ["integer", "string"] },
    contextUrl: {
      description:
        "Optional HTTPS page URL voters should inspect. For images, upload bytes first and use imageUrls. Required when both imageUrls and videoUrl are empty.",
      type: "string",
    },
    description: { description: "Optional question details shown to voters.", type: "string" },
    imageUrls: {
      description:
        "Image URLs returned by rateloop_upload_image for public mockups, screenshots, or generated visuals. Required only when both contextUrl and videoUrl are empty.",
      items: { type: "string" },
      type: "array",
    },
    tags: {
      description: "One to three public tags.",
      items: { type: "string" },
      type: ["array", "string"],
    },
    targetAudience: {
      additionalProperties: true,
      description: "Optional public self-reported audience hints. Advisory only; it does not hard-gate voters.",
      properties: {
        countries: { items: { type: "string" }, type: "array" },
        expertise: { items: { type: "string" }, type: "array" },
        languages: { items: { type: "string" }, type: "array" },
        roles: { items: { type: "string" }, type: "array" },
      },
      type: "object",
    },
    title: { description: "Question title shown to voters.", type: "string" },
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
    bountyStartBy: {
      description: "Unix timestamp in seconds by which the first private round must start.",
      type: ["integer", "string"],
    },
    bountyWindowSeconds: {
      description: "Bounty eligibility window duration after the first private round starts.",
      type: ["integer", "string"],
    },
    feedbackWindowSeconds: {
      description: "Paid feedback window duration after the first private round starts.",
      type: ["integer", "string"],
    },
    bountyEligibility: {
      default: 0,
      description: "Bounty payout scope: 0 everyone, 1 verified humans. Everyone can still answer.",
      enum: [0, 1, "0", "1"],
      type: ["integer", "string"],
    },
    requiredSettledRounds: {
      description: "Required settled rounds for the bounty.",
      type: ["integer", "string"],
    },
    requiredVoters: {
      description: "Minimum eligible voters required by the bounty.",
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
      enum: ["USDC", "usdc"],
      type: "string",
    },
    awarder: {
      ...evmAddressSchema,
      description:
        "Wallet allowed to award useful hidden rater feedback after settlement. Defaults to the asking wallet.",
    },
    feedbackClosesAt: {
      description:
        "Unix timestamp in seconds when feedback bonus awards close. Defaults to bounty.bountyStartBy + bounty.feedbackWindowSeconds.",
      type: ["integer", "string"],
    },
  },
  required: ["amount"],
  type: "object",
} satisfies JsonSchema;

const agentRoundConfigInputSchema = {
  additionalProperties: false,
  properties: {
    epochDuration: { type: ["integer", "string"] },
    maxDuration: { type: ["integer", "string"] },
    maxVoters: { type: ["integer", "string"] },
    minVoters: { type: ["integer", "string"] },
  },
  type: "object",
} satisfies JsonSchema;

export const agentOperationLookupInputSchema = {
  additionalProperties: false,
  properties: {
    chainId: { description: "Chain id used with clientRequestId lookup.", type: "integer" },
    clientRequestId: { description: "Client idempotency key returned by rateloop_ask_humans.", type: "string" },
    operationKey: { description: "RateLoop operation key returned by quote or ask.", type: "string" },
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
        "Alternative to imageBase64. A data:image/png;base64,..., data:image/jpeg;base64,..., or data:image/webp;base64,... URL.",
      type: "string",
    },
    imageBase64: {
      description: "Base64-encoded raw image bytes. Use this when uploading an AI-generated mockup directly.",
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
  question: agentQuestionInputSchema,
  questions: {
    description: "Ordered bundle of question payloads. The bounty pays only when every question is answered.",
    items: agentQuestionInputSchema,
    type: "array",
  },
  feedbackBonus: {
    ...agentFeedbackBonusInputSchema,
    description:
      "Optional LREP or USDC pool for useful hidden feedback from revealed raters. LREP requires wallet_calls funding mode; x402_authorization remains USDC-only. Currently supported for single-question asks.",
  },
  roundConfig: agentRoundConfigInputSchema,
  ...templateSelectorSchema.properties,
} satisfies JsonSchema;

export const agentQuoteInputSchema = {
  additionalProperties: true,
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
  properties: {
    ...agentAskInputBaseProperties,
    maxPaymentAmount: {
      description: "Maximum total bounty spend in atomic USDC.",
      pattern: "^\\d+$",
      type: "string",
    },
    mode: {
      default: "sync",
      description: "Use async to return after payment settlement and poll with rateloop_get_question_status.",
      enum: ["sync", "async"],
      type: "string",
    },
    paymentAuthorization: {
      additionalProperties: false,
      description:
        "Signed EIP-3009 ReceiveWithAuthorization payload for paymentMode=x402_authorization. Omit signature on the first call to receive the authorization request.",
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
      default: "wallet_calls",
      description:
        "wallet_calls returns approve/reserve/submit transactions. x402_authorization returns a native USDC authorization request, then ordered reserve/submit transactions after signature.",
      enum: ["wallet_calls", "x402_authorization"],
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
  },
  required: ["clientRequestId", "bounty", "maxPaymentAmount"],
  type: "object",
} satisfies JsonSchema;

export const agentConfirmAskTransactionsInputSchema = {
  additionalProperties: false,
  properties: {
    operationKey: { description: "RateLoop operation key returned by rateloop_ask_humans.", type: "string" },
    transactionHashes: {
      description: "Transaction hashes produced by executing the wallet transaction plan.",
      items: { pattern: "^0x[a-fA-F0-9]{64}$", type: "string" },
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
      description: "Transaction hashes produced by executing the Feedback Bonus transaction plan.",
      items: { pattern: "^0x[a-fA-F0-9]{64}$", type: "string" },
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
    feedbackBonus: { type: "object" },
    operationKey: { type: "string" },
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
      enum: ["not_found", "awaiting_wallet_signature", "submitted", "failed"],
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
    pollAfterMs: { type: "integer" },
    statusTool: { type: "string" },
    transactionPlan: { type: ["object", "null"] },
    wallet: { type: "object" },
    paymentMode: { enum: ["wallet_calls", "x402_authorization"], type: "string" },
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
    answer: { type: "string" },
    answerScopes: { type: "object" },
    cohortSummary: { type: ["object", "null"] },
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
    featureTest: { type: ["object", "null"] },
    feedbackQuality: { type: "object" },
    liveAskGuidance: { type: ["object", "null"] },
    limitations: { items: { type: "string" }, type: "array" },
    majorObjections: { items: { type: "object" }, type: "array" },
    methodology: { type: "object" },
    operation: { type: ["object", "null"] },
    protocolState: { type: "object" },
    publicUrl: { type: ["string", "null"] },
    rationaleSummary: { type: "string" },
    ready: { type: "boolean" },
    recommendedNextAction: { type: "string" },
    wait: {
      additionalProperties: true,
      properties: {
        code: { type: "string" },
        recoverWith: { type: "string" },
      },
      type: "object",
    },
    sourceUrls: { items: { type: "string" }, type: "array" },
    stakeMass: { type: "object" },
    voteCount: { type: "number" },
  },
  required: [
    "ready",
    "answer",
    "answerScopes",
    "cohortSummary",
    "confidence",
    "distribution",
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
