import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ContentRegistryAbi,
  X402QuestionSubmitterAbi,
} from "@rateloop/contracts/abis";
import {
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseSignature,
  stringToHex,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildQuestionSpecHashes } from "../questionSpecs.js";
import { findAgentResultTemplate } from "../templates.js";
import {
  askHumansWithLocalSigner,
  buildLocalQuestionCanonicalPayload,
  loadLocalSignerConfig,
  signX402AuthorizationRequest,
  validateLocalSignerTransactionPlan,
  withLocalSignerWallet,
} from "../localSigner.js";
import {
  parseX402QuestionRequest,
  toCanonicalQuestionPayload,
} from "../x402QuestionPayload.js";
import type {
  AskHumansRequest,
  AskHumansResponse,
  RateLoopAgentClient,
  RateLoopAgentWalletTransactionCall,
} from "@rateloop/sdk/agent";

const PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const X402_SUBMITTER_ADDRESS =
  "0x00000000000000000000000000000000000000bb" as const;
const X402_USDC_ADDRESS = "0x00000000000000000000000000000000000000cc" as const;
const CONTENT_REGISTRY_ADDRESS =
  "0x00000000000000000000000000000000000000dd" as const;
const QUESTION_REWARD_ESCROW_ADDRESS =
  "0x00000000000000000000000000000000000000ee" as const;
const FEEDBACK_BONUS_ESCROW_ADDRESS =
  "0x00000000000000000000000000000000000000fb" as const;
const LREP_ADDRESS = "0x00000000000000000000000000000000000000aa" as const;
const FEEDBACK_BONUS_CONTENT_ID = 123n;
const FEEDBACK_BONUS_ROUND_ID = 1n;
const X402_AMOUNT = "1500000";
const FEEDBACK_BONUS_AMOUNT = "2000000";
const CLIENT_REQUEST_ID = "local-signer-test";
const QUESTION_CONTEXT_URL = "https://example.com/context";
const QUESTION_TITLE = "Should this agent proceed?";
const QUESTION_TAG = "agent";
const UPLOADED_IMAGE_URL_A =
  "https://www.rateloop.ai/api/attachments/images/att_aaaaaaaaaaaaaaaa.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const UPLOADED_IMAGE_URL_B =
  "https://www.rateloop.ai/api/attachments/images/att_bbbbbbbbbbbbbbbb.webp#sha256=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const UPLOADED_IMAGE_URL_PREFIXED =
  "https://www.rateloop.ai/rateloop/api/attachments/images/att_cccccccccccccccc.webp#sha256=0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const LOCALHOST_UPLOADED_IMAGE_URL =
  "http://localhost:3000/api/attachments/images/att_localhostimage01.webp#sha256=0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const LOCALHOST_DETAILS_URL =
  "http://localhost:3000/api/attachments/details/det_localhostdetails01";
const QUESTION_METADATA_BASE_URL = "https://ponder.rateloop.ai";
const BOUNTY_START_BY = 0n;
const BOUNTY_WINDOW_SECONDS = 1_200n;
const FEEDBACK_WINDOW_SECONDS = 1_200n;
const X402_VALID_AFTER = "0";
// Must stay within the local signer's 24-hour validBefore sanity cap.
const X402_VALID_BEFORE = String(Math.floor(Date.now() / 1000) + 3_600);
const TEST_SIGNATURE = `0x${"1".repeat(64)}${"3".repeat(64)}1b` as const;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}` as const;
const EMPTY_DETAILS = {
  detailsUrl: "",
  detailsHash: EMPTY_DETAILS_HASH,
} as const;
const QUESTION_CONTEXT_DOMAIN = keccak256(
  stringToHex("rateloop-question-context-v5"),
);
const QUESTION_REVEAL_DOMAIN = keccak256(
  stringToHex("rateloop-question-reveal-v9"),
);
const X402_SIGN_OPTIONS: NonNullable<
  Parameters<typeof signX402AuthorizationRequest>[2]
> = {
  expectedAmount: X402_AMOUNT,
  expectedChainId: 480,
  expectedUsdcAddress: X402_USDC_ADDRESS,
  expectedX402QuestionSubmitterAddress: X402_SUBMITTER_ADDRESS,
};

const ZERO_CONFIDENTIALITY_HASH = keccak256(
  encodeAbiParameters(
    [
      { type: "bool" },
      { type: "uint8" },
      { type: "uint64" },
      { type: "uint8" },
    ],
    [false, 0, 0n, 0],
  ),
);
const PRIVATE_FOREVER_CONFIDENTIALITY_HASH = keccak256(
  encodeAbiParameters(
    [
      { type: "bool" },
      { type: "uint8" },
      { type: "uint64" },
      { type: "uint8" },
    ],
    [true, 0, 0n, 1],
  ),
);
const ZERO_CONFIDENTIALITY_CONFIG = {
  bondAmount: 0n,
  bondAsset: 0,
  flags: 0,
  gated: false,
} as const;
const ContentRegistrySubmitQuestionWithConfidentialityAbi =
  ContentRegistryAbi.filter(
    (item) =>
      item.type === "function" &&
      item.name === "submitQuestionWithRewardAndRoundConfig" &&
      item.inputs.length === 12,
  ) as Abi;
const X402QuestionSubmitterSubmitWithConfidentialityAbi =
  X402QuestionSubmitterAbi.filter(
    (item) =>
      item.type === "function" &&
      item.name === "submitQuestionWithX402Payment" &&
      item.inputs.length === 13,
  ) as Abi;
const X402QuestionSubmitterOneShotSubmitWithConfidentialityAbi = [
  {
    inputs: [
      { name: "contextUrl", type: "string" },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
      { name: "title", type: "string" },
      { name: "tags", type: "string" },
      { name: "categoryId", type: "uint256" },
      {
        components: [
          { name: "detailsUrl", type: "string" },
          { name: "detailsHash", type: "bytes32" },
        ],
        name: "details",
        type: "tuple",
      },
      { name: "salt", type: "bytes32" },
      {
        components: [
          { name: "asset", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "requiredVoters", type: "uint256" },
          { name: "bountyEligibility", type: "uint8" },
        ],
        name: "rewardTerms",
        type: "tuple",
      },
      {
        components: [
          { name: "epochDuration", type: "uint32" },
          { name: "maxDuration", type: "uint32" },
          { name: "minVoters", type: "uint16" },
          { name: "maxVoters", type: "uint16" },
        ],
        name: "roundConfig",
        type: "tuple",
      },
      {
        components: [
          { name: "questionMetadataHash", type: "bytes32" },
          { name: "resultSpecHash", type: "bytes32" },
        ],
        name: "spec",
        type: "tuple",
      },
      {
        components: [
          { name: "gated", type: "bool" },
          { name: "bondAsset", type: "uint8" },
          { name: "bondAmount", type: "uint64" },
          { name: "flags", type: "uint8" },
        ],
        name: "confidentiality",
        type: "tuple",
      },
      {
        components: [
          { name: "amount", type: "uint256" },
          { name: "awarder", type: "address" },
        ],
        name: "feedbackBonusTerms",
        type: "tuple",
      },
      {
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
        name: "paymentAuthorization",
        type: "tuple",
      },
    ],
    name: "submitQuestionWithX402OneShotPayment",
    outputs: [
      { name: "contentId", type: "uint256" },
      { name: "feedbackBonusPoolId", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as Abi;

type TestX402AuthorizationRequest = {
  authorization: Record<string, string>;
  typedData: {
    domain: Record<string, number | string>;
    message: Record<string, string>;
    primaryType: string;
    types: Record<string, Array<{ name: string; type: string }>>;
  };
};

const BYTES32_ONE = `0x${"1".repeat(64)}` as const;
type TestSubmissionRewardAsset = "USDC" | "LREP";

function rewardTerms(
  amount = BigInt(X402_AMOUNT),
  asset: TestSubmissionRewardAsset = "USDC",
) {
  return {
    amount,
    asset: asset === "LREP" ? 0 : 1,
    bountyEligibility: 0,
    requiredVoters: 3n,
  };
}

function roundConfigBigInt() {
  return {
    questionDurationSeconds: 1_200n,
    maxVoters: 100n,
    minVoters: 3n,
  };
}

function roundConfig() {
  return {
    epochDuration: 1_200,
    maxDuration: 1_200,
    maxVoters: 100,
    minVoters: 3,
  };
}

function questionSpec(questionMetadataBaseUrl?: string) {
  const template = findAgentResultTemplate("generic_rating");
  if (!template) throw new Error("Missing generic_rating template.");
  return buildQuestionSpecHashes(
    {
      bounty: {
        amount: BigInt(X402_AMOUNT),
        asset: "USDC",
        bountyEligibility: 0,
        requiredVoters: 3n,
      },
      categoryId: 1n,
      contextUrl: QUESTION_CONTEXT_URL,
      imageUrls: [],
      roundConfig: roundConfigBigInt(),
      study: { bundleIndex: 0 },
      tags: [QUESTION_TAG],
      targetAudience: null,
      templateId: "generic_rating",
      templateInputs: null,
      templateVersion: 1,
      title: QUESTION_TITLE,
      videoUrl: "",
      voteSemantics: template.voteSemantics,
    },
    { questionMetadataBaseUrl },
  );
}

function canonicalPayload(questionMetadataBaseUrl?: string) {
  return buildLocalQuestionCanonicalPayload(askPayload(), 480, {
    questionMetadataBaseUrl,
  });
}

function expectedPayloadHash(questionMetadataBaseUrl?: string) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalPayload(questionMetadataBaseUrl)))
    .digest("hex");
}

function expectedOperationKey(questionMetadataBaseUrl?: string) {
  return `0x${createHash("sha256")
    .update(
      `rateloop:x402-question:${expectedPayloadHash(questionMetadataBaseUrl)}`,
    )
    .digest("hex")}` as const;
}

function payloadHashFor(payload: AskHumansRequest) {
  return createHash("sha256")
    .update(JSON.stringify(buildLocalQuestionCanonicalPayload(payload, 480)))
    .digest("hex");
}

function operationKeyFor(payload: AskHumansRequest) {
  return `0x${createHash("sha256")
    .update(`rateloop:x402-question:${payloadHashFor(payload)}`)
    .digest("hex")}` as const;
}

function expectedSubmissionKey() {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      [
        QUESTION_CONTEXT_DOMAIN,
        1n,
        keccak256(
          encodeAbiParameters(
            [{ type: "string[]" }, { type: "string" }],
            [[], ""],
          ),
        ),
        submissionDetailsHash(),
        QUESTION_CONTEXT_URL,
        QUESTION_TITLE,
        QUESTION_TAG,
      ],
    ),
  );
}

function submissionMediaHash(imageUrls: readonly string[], videoUrl: string) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string[]" }, { type: "string" }],
      [[...new Set(imageUrls)].sort(), videoUrl],
    ),
  );
}

function submissionDetailsHashFor(detailsUrl: string, detailsHash: Hex) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }],
      [detailsUrl, detailsHash],
    ),
  );
}

function submissionKeyForPayload(payload: AskHumansRequest) {
  const canonical = buildLocalQuestionCanonicalPayload(payload, 480);
  const question = canonical.questions[0];
  if (!question) throw new Error("Missing canonical question.");
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      [
        QUESTION_CONTEXT_DOMAIN,
        BigInt(question.categoryId),
        submissionMediaHash(question.imageUrls, question.videoUrl),
        submissionDetailsHashFor(
          question.detailsUrl,
          question.detailsHash as Hex,
        ),
        question.contextUrl,
        question.title,
        question.tags.join(","),
      ],
    ),
  );
}

function saltForPayload(payload: AskHumansRequest) {
  return `0x${createHash("sha256")
    .update(
      [
        "rateloop",
        "agent-wallet-question-salt",
        operationKeyFor(payload),
        payloadHashFor(payload),
        account.address.toLowerCase(),
        submissionKeyForPayload(payload),
        "0",
      ].join(":"),
    )
    .digest("hex")}` as const;
}

function expectedSalt(questionMetadataBaseUrl?: string) {
  return `0x${createHash("sha256")
    .update(
      [
        "rateloop",
        "agent-wallet-question-salt",
        expectedOperationKey(questionMetadataBaseUrl),
        expectedPayloadHash(questionMetadataBaseUrl),
        account.address.toLowerCase(),
        expectedSubmissionKey(),
        "0",
      ].join(":"),
    )
    .digest("hex")}` as const;
}

function rewardTermsHash() {
  const terms = rewardTerms();
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint8" },
      ],
      [
        terms.asset,
        terms.amount,
        terms.requiredVoters,
        terms.bountyEligibility,
      ],
    ),
  );
}

function rewardTermsHashForPayload(payload: AskHumansRequest) {
  const canonical = buildLocalQuestionCanonicalPayload(payload, 480);
  const terms = rewardTerms(
    BigInt(canonical.bounty.amount),
    canonical.bounty.asset === "LREP" ? "LREP" : "USDC",
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint8" },
      ],
      [
        terms.asset,
        terms.amount,
        terms.requiredVoters,
        terms.bountyEligibility,
      ],
    ),
  );
}

function roundConfigHash() {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint32" },
        { type: "uint32" },
        { type: "uint16" },
        { type: "uint16" },
      ],
      [1_200, 1_200, 3, 100],
    ),
  );
}

function submissionDetailsHash() {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }],
      ["", EMPTY_DETAILS_HASH],
    ),
  );
}

function expectedRevealCommitment(questionMetadataBaseUrl?: string) {
  const spec = questionSpec(questionMetadataBaseUrl);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        QUESTION_REVEAL_DOMAIN,
        expectedSubmissionKey(),
        keccak256(
          encodeAbiParameters(
            [{ type: "string[]" }, { type: "string" }],
            [[], ""],
          ),
        ),
        keccak256(
          encodeAbiParameters(
            [{ type: "string" }, { type: "string" }],
            [QUESTION_TITLE, QUESTION_TAG],
          ),
        ),
        submissionDetailsHash(),
        1n,
        expectedSalt(questionMetadataBaseUrl),
        account.address,
        rewardTermsHash(),
        roundConfigHash(),
        spec.questionMetadataHash,
        spec.resultSpecHash,
        ZERO_CONFIDENTIALITY_HASH,
      ],
    ),
  );
}

function revealCommitmentForPayload(payload: AskHumansRequest) {
  const canonical = buildLocalQuestionCanonicalPayload(payload, 480);
  const question = canonical.questions[0];
  if (!question) throw new Error("Missing canonical question.");
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        QUESTION_REVEAL_DOMAIN,
        submissionKeyForPayload(payload),
        submissionMediaHash(question.imageUrls, question.videoUrl),
        keccak256(
          encodeAbiParameters(
            [{ type: "string" }, { type: "string" }],
            [question.title, question.tags.join(",")],
          ),
        ),
        submissionDetailsHashFor(
          question.detailsUrl,
          question.detailsHash as Hex,
        ),
        BigInt(question.categoryId),
        saltForPayload(payload),
        account.address,
        rewardTermsHashForPayload(payload),
        roundConfigHash(),
        question.questionMetadataHash as Hex,
        question.resultSpecHash as Hex,
        ZERO_CONFIDENTIALITY_HASH,
      ],
    ),
  );
}

function x402StringArrayHash(values: readonly string[]) {
  return keccak256(
    `0x${values.map((value) => keccak256(stringToHex(value)).slice(2)).join("")}` as Hex,
  );
}

function x402PaymentNonce(
  from = account.address,
  questionMetadataBaseUrl?: string,
) {
  const spec = questionSpec(questionMetadataBaseUrl);
  const submissionPayloadHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex(QUESTION_CONTEXT_URL)),
        x402StringArrayHash([]),
        keccak256(stringToHex("")),
        keccak256(stringToHex("")),
        EMPTY_DETAILS_HASH,
        keccak256(stringToHex(QUESTION_TITLE)),
        keccak256(stringToHex(QUESTION_TAG)),
        1n,
        expectedSalt(questionMetadataBaseUrl),
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex("rateloop-x402-question-payment-v4")),
        480n,
        CONTENT_REGISTRY_ADDRESS,
        QUESTION_REWARD_ESCROW_ADDRESS,
        X402_SUBMITTER_ADDRESS,
        from,
        X402_SUBMITTER_ADDRESS,
        BigInt(X402_AMOUNT),
        BigInt(X402_VALID_AFTER),
        BigInt(X402_VALID_BEFORE),
        submissionPayloadHash,
        rewardTermsHash(),
        roundConfigHash(),
        ZERO_CONFIDENTIALITY_HASH,
        spec.questionMetadataHash,
        spec.resultSpecHash,
      ],
    ),
  );
}

function x402PaymentNonceForPayload(
  payload: AskHumansRequest,
  from = account.address,
) {
  const canonical = buildLocalQuestionCanonicalPayload(payload, 480);
  const question = canonical.questions[0];
  if (!question) throw new Error("Missing canonical question.");
  const submissionPayloadHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex(question.contextUrl)),
        x402StringArrayHash(question.imageUrls),
        keccak256(stringToHex(question.videoUrl)),
        keccak256(stringToHex(question.detailsUrl)),
        question.detailsHash as Hex,
        keccak256(stringToHex(question.title)),
        keccak256(stringToHex(question.tags.join(","))),
        BigInt(question.categoryId),
        saltForPayload(payload),
      ],
    ),
  );

  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex("rateloop-x402-question-payment-v4")),
        480n,
        CONTENT_REGISTRY_ADDRESS,
        QUESTION_REWARD_ESCROW_ADDRESS,
        X402_SUBMITTER_ADDRESS,
        from,
        X402_SUBMITTER_ADDRESS,
        BigInt(X402_AMOUNT),
        BigInt(X402_VALID_AFTER),
        BigInt(X402_VALID_BEFORE),
        submissionPayloadHash,
        rewardTermsHash(),
        roundConfigHash(),
        PRIVATE_FOREVER_CONFIDENTIALITY_HASH,
        question.questionMetadataHash as Hex,
        question.resultSpecHash as Hex,
      ],
    ),
  );
}

function x402OneShotPaymentNonceForPayload(
  payload: AskHumansRequest,
  from = account.address,
) {
  const canonical = buildLocalQuestionCanonicalPayload(payload, 480);
  const question = canonical.questions[0];
  if (!question) throw new Error("Missing canonical question.");
  const feedbackBonus = payload.feedbackBonus;
  if (!feedbackBonus) throw new Error("Missing feedback bonus.");
  const submissionPayloadHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex(question.contextUrl)),
        x402StringArrayHash(question.imageUrls),
        keccak256(stringToHex(question.videoUrl)),
        keccak256(stringToHex(question.detailsUrl)),
        question.detailsHash as Hex,
        keccak256(stringToHex(question.title)),
        keccak256(stringToHex(question.tags.join(","))),
        BigInt(question.categoryId),
        saltForPayload(payload),
      ],
    ),
  );
  const feedbackBonusTermsHash = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }],
      [
        BigInt(String(feedbackBonus.amount)),
        String(feedbackBonus.awarder) as `0x${string}`,
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex("rateloop-x402-question-one-shot-payment-v6")),
        480n,
        CONTENT_REGISTRY_ADDRESS,
        QUESTION_REWARD_ESCROW_ADDRESS,
        FEEDBACK_BONUS_ESCROW_ADDRESS,
        X402_SUBMITTER_ADDRESS,
        from,
        X402_SUBMITTER_ADDRESS,
        BigInt(X402_AMOUNT) + BigInt(FEEDBACK_BONUS_AMOUNT),
        BigInt(X402_VALID_AFTER),
        BigInt(X402_VALID_BEFORE),
        submissionPayloadHash,
        rewardTermsHash(),
        roundConfigHash(),
        ZERO_CONFIDENTIALITY_HASH,
        feedbackBonusTermsHash,
        question.questionMetadataHash as Hex,
        question.resultSpecHash as Hex,
      ],
    ),
  );
}

function reserveSubmissionData(revealCommitment = expectedRevealCommitment()) {
  return encodeFunctionData({
    abi: ContentRegistryAbi,
    args: [revealCommitment],
    functionName: "reserveSubmission",
  });
}

function submitQuestionData(
  amount = BigInt(X402_AMOUNT),
  questionMetadataBaseUrl?: string,
) {
  return encodeFunctionData({
    abi: ContentRegistrySubmitQuestionWithConfidentialityAbi,
    args: [
      QUESTION_CONTEXT_URL,
      [],
      "",
      QUESTION_TITLE,
      QUESTION_TAG,
      1n,
      EMPTY_DETAILS,
      expectedSalt(questionMetadataBaseUrl),
      rewardTerms(amount),
      roundConfig(),
      questionSpec(questionMetadataBaseUrl),
      ZERO_CONFIDENTIALITY_CONFIG,
    ],
    functionName: "submitQuestionWithRewardAndRoundConfig",
  });
}

function submitQuestionDataForPayload(payload: AskHumansRequest) {
  const canonical = buildLocalQuestionCanonicalPayload(payload, 480);
  const question = canonical.questions[0];
  if (!question) throw new Error("Missing canonical question.");
  const asset = canonical.bounty.asset === "LREP" ? "LREP" : "USDC";
  const questionDurationSeconds = Number(
    canonical.roundConfig.questionDurationSeconds,
  );
  return encodeFunctionData({
    abi: ContentRegistrySubmitQuestionWithConfidentialityAbi,
    args: [
      question.contextUrl,
      question.imageUrls,
      question.videoUrl,
      question.title,
      question.tags.join(","),
      BigInt(question.categoryId),
      {
        detailsHash: question.detailsHash as Hex,
        detailsUrl: question.detailsUrl,
      },
      saltForPayload(payload),
      rewardTerms(BigInt(canonical.bounty.amount), asset),
      {
        epochDuration: questionDurationSeconds,
        maxDuration: questionDurationSeconds,
        maxVoters: Number(canonical.roundConfig.maxVoters),
        minVoters: Number(canonical.roundConfig.minVoters),
      },
      {
        questionMetadataHash: question.questionMetadataHash as Hex,
        resultSpecHash: question.resultSpecHash as Hex,
      },
      ZERO_CONFIDENTIALITY_CONFIG,
    ],
    functionName: "submitQuestionWithRewardAndRoundConfig",
  });
}

function submitX402QuestionData(
  amount = BigInt(X402_AMOUNT),
  questionMetadataBaseUrl?: string,
) {
  const signature = parseSignature(TEST_SIGNATURE);
  return encodeFunctionData({
    abi: X402QuestionSubmitterSubmitWithConfidentialityAbi,
    args: [
      QUESTION_CONTEXT_URL,
      [],
      "",
      QUESTION_TITLE,
      QUESTION_TAG,
      1n,
      EMPTY_DETAILS,
      expectedSalt(questionMetadataBaseUrl),
      rewardTerms(amount),
      roundConfig(),
      questionSpec(questionMetadataBaseUrl),
      ZERO_CONFIDENTIALITY_CONFIG,
      {
        from: account.address,
        nonce: x402PaymentNonce(account.address, questionMetadataBaseUrl),
        r: signature.r,
        s: signature.s,
        to: X402_SUBMITTER_ADDRESS,
        v: Number(signature.v ?? BigInt(signature.yParity + 27)),
        validAfter: BigInt(X402_VALID_AFTER),
        validBefore: BigInt(X402_VALID_BEFORE),
        value: amount,
      },
    ],
    functionName: "submitQuestionWithX402Payment",
  });
}

function submitX402OneShotQuestionData(payload = feedbackBonusAskPayload()) {
  const signature = parseSignature(TEST_SIGNATURE);
  const totalAmount = BigInt(X402_AMOUNT) + BigInt(FEEDBACK_BONUS_AMOUNT);
  return encodeFunctionData({
    abi: X402QuestionSubmitterOneShotSubmitWithConfidentialityAbi,
    args: [
      QUESTION_CONTEXT_URL,
      [],
      "",
      QUESTION_TITLE,
      QUESTION_TAG,
      1n,
      EMPTY_DETAILS,
      saltForPayload(payload),
      rewardTerms(BigInt(X402_AMOUNT)),
      roundConfig(),
      questionSpec(),
      ZERO_CONFIDENTIALITY_CONFIG,
      {
        amount: BigInt(FEEDBACK_BONUS_AMOUNT),
        awarder: account.address,
      },
      {
        from: account.address,
        nonce: x402OneShotPaymentNonceForPayload(payload),
        r: signature.r,
        s: signature.s,
        to: X402_SUBMITTER_ADDRESS,
        v: Number(signature.v ?? BigInt(signature.yParity + 27)),
        validAfter: BigInt(X402_VALID_AFTER),
        validBefore: BigInt(X402_VALID_BEFORE),
        value: totalAmount,
      },
    ],
    functionName: "submitQuestionWithX402OneShotPayment",
  });
}

function signedX402Authorization(
  overrides: Partial<
    Record<
      keyof ReturnType<typeof x402AuthorizationRequest>["authorization"],
      string
    >
  > = {},
) {
  return {
    ...x402AuthorizationRequest().authorization,
    ...overrides,
    signature: TEST_SIGNATURE,
  };
}

function signedOneShotX402Authorization(payload = feedbackBonusAskPayload()) {
  return {
    ...x402AuthorizationRequest().authorization,
    nonce: x402OneShotPaymentNonceForPayload(payload),
    signature: TEST_SIGNATURE,
    value: (BigInt(X402_AMOUNT) + BigInt(FEEDBACK_BONUS_AMOUNT)).toString(),
  };
}

function walletCallsResponse(
  overrides: Partial<AskHumansResponse> = {},
  questionMetadataBaseUrl?: string,
): AskHumansResponse {
  return {
    chainId: 480,
    operationKey: expectedOperationKey(questionMetadataBaseUrl),
    payment: {
      amount: X402_AMOUNT,
      asset: "USDC",
      spender: QUESTION_REWARD_ESCROW_ADDRESS,
      tokenAddress: X402_USDC_ADDRESS,
    },
    paymentMode: "wallet_calls",
    payloadHash: expectedPayloadHash(questionMetadataBaseUrl),
    questionMetadataBaseUrl,
    status: "awaiting_wallet_signature",
    transactionPlan: {
      calls: [
        {
          data: reserveSubmissionData(
            expectedRevealCommitment(questionMetadataBaseUrl),
          ),
          phase: "reserve_submission",
          to: CONTENT_REGISTRY_ADDRESS,
          value: "0",
        },
        {
          data: encodeFunctionData({
            abi: erc20Abi,
            args: [QUESTION_REWARD_ESCROW_ADDRESS, BigInt(X402_AMOUNT)],
            functionName: "approve",
          }),
          phase: "approve_usdc",
          to: X402_USDC_ADDRESS,
          value: "0",
        },
        {
          data: submitQuestionData(
            BigInt(X402_AMOUNT),
            questionMetadataBaseUrl,
          ),
          phase: "submit_question",
          to: CONTENT_REGISTRY_ADDRESS,
          value: "0",
        },
      ],
      requiresOrderedExecution: true,
    },
    wallet: { address: account.address, fundingMode: "agent_wallet" },
    ...overrides,
  };
}

function lrepWalletCallsResponse(
  payload: AskHumansRequest,
  overrides: Partial<AskHumansResponse> = {},
): AskHumansResponse {
  return {
    chainId: 480,
    operationKey: operationKeyFor(payload),
    payment: {
      amount: X402_AMOUNT,
      asset: "LREP",
      spender: QUESTION_REWARD_ESCROW_ADDRESS,
      tokenAddress: LREP_ADDRESS,
    },
    paymentMode: "wallet_calls",
    payloadHash: payloadHashFor(payload),
    status: "awaiting_wallet_signature",
    transactionPlan: {
      calls: [
        {
          data: reserveSubmissionData(revealCommitmentForPayload(payload)),
          phase: "reserve_submission",
          to: CONTENT_REGISTRY_ADDRESS,
          value: "0",
        },
        {
          data: encodeFunctionData({
            abi: erc20Abi,
            args: [QUESTION_REWARD_ESCROW_ADDRESS, BigInt(X402_AMOUNT)],
            functionName: "approve",
          }),
          phase: "approve_lrep",
          to: LREP_ADDRESS,
          value: "0",
        },
        {
          data: submitQuestionDataForPayload(payload),
          phase: "submit_question",
          to: CONTENT_REGISTRY_ADDRESS,
          value: "0",
        },
      ],
      requiresOrderedExecution: true,
    },
    wallet: { address: account.address, fundingMode: "agent_wallet" },
    ...overrides,
  };
}

function feedbackBonusCreatePoolData(
  payload = feedbackBonusAskPayload(),
  overrides: {
    contentId?: bigint;
    feedbackClosesAt?: bigint;
    roundId?: bigint;
  } = {},
): Hex {
  const bonus = payload.feedbackBonus!;
  const bonusAsset = bonus.asset ?? payload.bounty.asset ?? "USDC";
  return encodeFunctionData({
    abi: [
      {
        inputs: [
          { name: "contentId", type: "uint256" },
          { name: "roundId", type: "uint256" },
          { name: "asset", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "feedbackClosesAt", type: "uint256" },
          { name: "awarder", type: "address" },
        ],
        name: "createFeedbackBonusPoolWithAsset",
        outputs: [{ name: "poolId", type: "uint256" }],
        stateMutability: "nonpayable",
        type: "function",
      },
    ] as Abi,
    args: [
      overrides.contentId ?? FEEDBACK_BONUS_CONTENT_ID,
      overrides.roundId ?? FEEDBACK_BONUS_ROUND_ID,
      bonusAsset === "LREP" ? 0 : 1,
      BigInt(String(bonus.amount)),
      overrides.feedbackClosesAt ?? BigInt(feedbackBonusClosesAt()),
      (bonus.awarder ?? account.address) as `0x${string}`,
    ],
    functionName: "createFeedbackBonusPoolWithAsset",
  });
}

function feedbackBonusPlanResponse(
  payload = feedbackBonusAskPayload(),
  overrides: Partial<AskHumansResponse> = {},
): AskHumansResponse {
  const bonus = payload.feedbackBonus!;
  const bonusAsset = bonus.asset ?? payload.bounty.asset ?? "USDC";
  const tokenAddress = bonusAsset === "LREP" ? LREP_ADDRESS : X402_USDC_ADDRESS;
  const approvePhase =
    bonusAsset === "LREP"
      ? "approve_feedback_bonus_lrep"
      : "approve_feedback_bonus_usdc";

  return {
    chainId: 480,
    feedbackBonus: {
      amount: String(bonus.amount),
      asset: bonusAsset,
      status: "awaiting_wallet_signature",
      contentId: FEEDBACK_BONUS_CONTENT_ID.toString(),
      feedbackClosesAt: feedbackBonusClosesAt(),
      roundId: FEEDBACK_BONUS_ROUND_ID.toString(),
      transactionPlan: {
        calls: [
          {
            data: encodeFunctionData({
              abi: erc20Abi,
              args: [
                FEEDBACK_BONUS_ESCROW_ADDRESS,
                BigInt(String(bonus.amount)),
              ],
              functionName: "approve",
            }),
            phase: approvePhase,
            to: tokenAddress,
            value: "0",
          },
          {
            data: feedbackBonusCreatePoolData(payload),
            phase: "create_feedback_bonus_pool",
            to: FEEDBACK_BONUS_ESCROW_ADDRESS,
            value: "0",
          },
        ],
        requiresOrderedExecution: true,
      },
    },
    operationKey: operationKeyFor(payload),
    status: "submitted",
    ...overrides,
  };
}

function feedbackBonusClosesAt() {
  return (BOUNTY_START_BY + FEEDBACK_WINDOW_SECONDS).toString();
}

function feedbackBonusAskPayload(
  overrides: Partial<NonNullable<AskHumansRequest["feedbackBonus"]>> = {},
): AskHumansRequest {
  const payload = askPayload();
  payload.maxPaymentAmount = (
    BigInt(X402_AMOUNT) + BigInt(FEEDBACK_BONUS_AMOUNT)
  ).toString();
  payload.feedbackBonus = {
    amount: FEEDBACK_BONUS_AMOUNT,
    asset: "USDC",
    awarder: account.address,
    ...overrides,
  };
  return payload;
}

function x402CallsResponse(
  overrides: Partial<AskHumansResponse> = {},
  questionMetadataBaseUrl?: string,
): AskHumansResponse {
  return {
    chainId: 480,
    operationKey: expectedOperationKey(questionMetadataBaseUrl),
    payment: {
      amount: X402_AMOUNT,
      asset: "USDC",
      spender: X402_SUBMITTER_ADDRESS,
      tokenAddress: X402_USDC_ADDRESS,
    },
    paymentMode: "x402_authorization",
    payloadHash: expectedPayloadHash(questionMetadataBaseUrl),
    questionMetadataBaseUrl,
    status: "awaiting_wallet_signature",
    transactionPlan: {
      calls: [
        {
          data: submitX402QuestionData(
            BigInt(X402_AMOUNT),
            questionMetadataBaseUrl,
          ),
          phase: "submit_x402_question",
          to: X402_SUBMITTER_ADDRESS,
          value: "0",
        },
      ],
      requiresOrderedExecution: true,
    },
    wallet: { address: account.address, fundingMode: "x402_authorization" },
    ...overrides,
  };
}

function x402OneShotCallsResponse(
  payload = feedbackBonusAskPayload(),
  overrides: Partial<AskHumansResponse> = {},
): AskHumansResponse {
  return {
    chainId: 480,
    operationKey: operationKeyFor(payload),
    payment: {
      amount: (BigInt(X402_AMOUNT) + BigInt(FEEDBACK_BONUS_AMOUNT)).toString(),
      asset: "USDC",
      bountyAmount: X402_AMOUNT,
      feedbackBonusAmount: FEEDBACK_BONUS_AMOUNT,
      feedbackBonusAsset: "USDC",
      spender: X402_SUBMITTER_ADDRESS,
      tokenAddress: X402_USDC_ADDRESS,
      totalAmount: (
        BigInt(X402_AMOUNT) + BigInt(FEEDBACK_BONUS_AMOUNT)
      ).toString(),
    },
    paymentMode: "x402_authorization",
    payloadHash: payloadHashFor(payload),
    status: "awaiting_wallet_signature",
    transactionPlan: {
      calls: [
        {
          data: submitX402OneShotQuestionData(payload),
          phase: "submit_x402_question",
          to: X402_SUBMITTER_ADDRESS,
          value: "0",
        },
      ],
      requiresOrderedExecution: true,
    },
    wallet: { address: account.address, fundingMode: "x402_authorization" },
    ...overrides,
  };
}

function validationConfig() {
  return {
    contentRegistryAddress: CONTENT_REGISTRY_ADDRESS,
    feedbackBonusEscrowAddress: FEEDBACK_BONUS_ESCROW_ADDRESS,
    lrepAddress: LREP_ADDRESS,
    questionRewardPoolEscrowAddress: QUESTION_REWARD_ESCROW_ADDRESS,
    usdcAddress: X402_USDC_ADDRESS,
    x402QuestionSubmitterAddress: X402_SUBMITTER_ADDRESS,
  };
}

function x402AuthorizationRequest(
  from = account.address,
): TestX402AuthorizationRequest {
  const authorization = {
    from,
    nonce: x402PaymentNonce(from),
    to: X402_SUBMITTER_ADDRESS,
    validAfter: X402_VALID_AFTER,
    validBefore: X402_VALID_BEFORE,
    value: X402_AMOUNT,
  };

  return {
    authorization,
    typedData: {
      domain: {
        chainId: 480,
        name: "USDC",
        verifyingContract: X402_USDC_ADDRESS,
        version: "2",
      },
      message: { ...authorization },
      primaryType: "ReceiveWithAuthorization",
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
    },
  };
}

function askPayload(walletAddress?: string): AskHumansRequest {
  return {
    bounty: {
      amount: X402_AMOUNT,
      bountyEligibility: "0",
      requiredVoters: "3",
    },
    clientRequestId: CLIENT_REQUEST_ID,
    maxPaymentAmount: X402_AMOUNT,
    question: {
      categoryId: "1",
      contextUrl: QUESTION_CONTEXT_URL,
      tags: [QUESTION_TAG],
      title: QUESTION_TITLE,
    },
    roundConfig: {
      questionDurationSeconds: "1200",
      maxVoters: "100",
      minVoters: "3",
    },
    walletAddress,
  };
}

function privateForeverAskPayload(): AskHumansRequest {
  const payload = askPayload();
  payload.question = {
    ...payload.question,
    confidentiality: {
      bond: {
        amount: "0",
        asset: "LREP",
      },
      disclosurePolicy: "private_forever",
      visibility: "gated",
    },
    contextUrl: "",
    detailsHash: `0x${"4".repeat(64)}`,
    detailsUrl:
      "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop",
  };
  return payload;
}

describe("local signer", () => {
  it("sets and guards the ask wallet address", () => {
    expect(
      withLocalSignerWallet(askPayload(), account.address).walletAddress,
    ).toBe(account.address);

    expect(() =>
      withLocalSignerWallet(
        askPayload("0x00000000000000000000000000000000000000aa"),
        account.address,
      ),
    ).toThrow(/does not match local signer/);
  });

  it("executes mixed-asset wallet-call Feedback Bonus plans", async () => {
    const payload = feedbackBonusAskPayload({ asset: "LREP" });
    payload.maxPaymentAmount = X402_AMOUNT;
    payload.paymentMode = "wallet_calls";
    const askResponse = walletCallsResponse();
    const confirmationResponse = feedbackBonusPlanResponse(payload);
    const transactions = {
      ask: [`0x${"a".repeat(64)}`],
      feedback_bonus: [`0x${"b".repeat(64)}`, `0x${"c".repeat(64)}`],
    } as const;
    const confirmed: unknown[] = [];
    const agent = {
      askHumans: async () => askResponse,
      confirmAskTransactions: async (request) => {
        confirmed.push({ plan: "ask", request });
        return confirmationResponse;
      },
      confirmFeedbackBonusTransactions: async (request) => {
        confirmed.push({ plan: "feedback_bonus", request });
        return {
          ...confirmationResponse,
          feedbackBonus: {
            ...confirmationResponse.feedbackBonus!,
            status: "funded",
            transactionHashes: request.transactionHashes,
          },
        };
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    > &
      Partial<Pick<RateLoopAgentClient, "confirmFeedbackBonusTransactions">>;

    const result = await askHumansWithLocalSigner({
      account,
      agent,
      config: {
        ...validationConfig(),
        chainId: 480,
        chainName: "test",
        pollingIntervalMs: 1,
        receiptTimeoutMs: 1,
      },
      executeTransactionPlan: async ({ calls, plan }) => {
        expect(calls).toHaveLength(plan === "feedback_bonus" ? 2 : 3);
        if (plan === "feedback_bonus") {
          expect(calls[0].phase).toBe("approve_feedback_bonus_lrep");
        }
        return { transactionHashes: [...transactions[plan]] };
      },
      payload,
    });

    expect(confirmed).toEqual([
      {
        plan: "ask",
        request: {
          operationKey: operationKeyFor(payload),
          transactionHashes: [...transactions.ask],
        },
      },
      {
        plan: "feedback_bonus",
        request: {
          operationKey: operationKeyFor(payload),
          transactionHashes: [...transactions.feedback_bonus],
        },
      },
    ]);
    expect(result.feedbackBonusConfirmed?.feedbackBonus?.asset).toBe("LREP");
    expect(result.feedbackBonusConfirmed?.feedbackBonus?.status).toBe("funded");
    expect(result.feedbackBonusTransactions?.transactionHashes).toEqual([
      ...transactions.feedback_bonus,
    ]);
  });

  it("still requires cap room for same-asset Feedback Bonuses", async () => {
    const payload = feedbackBonusAskPayload();
    payload.maxPaymentAmount = X402_AMOUNT;
    const agent = {
      askHumans: async () => {
        throw new Error("askHumans should not run");
      },
      confirmAskTransactions: async () => {
        throw new Error("confirmAskTransactions should not run");
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    >;

    await expect(
      askHumansWithLocalSigner({
        account,
        agent,
        config: {
          ...validationConfig(),
          chainId: 480,
          chainName: "test",
          pollingIntervalMs: 1,
          receiptTimeoutMs: 1,
        },
        payload,
      }),
    ).rejects.toThrow(/Quoted payment exceeds maxPaymentAmount/);
  });

  it("executes the follow-up wallet-call Feedback Bonus plan", async () => {
    const payload = feedbackBonusAskPayload();
    payload.paymentMode = "agent_wallet" as never;
    const askResponse = walletCallsResponse();
    const confirmationResponse = feedbackBonusPlanResponse(payload);
    const transactions = {
      ask: [`0x${"a".repeat(64)}`],
      feedback_bonus: [`0x${"b".repeat(64)}`, `0x${"c".repeat(64)}`],
    } as const;
    const confirmed: unknown[] = [];
    const progress: unknown[] = [];
    const agent = {
      askHumans: async () => askResponse,
      confirmAskTransactions: async (request) => {
        confirmed.push({ plan: "ask", request });
        return confirmationResponse;
      },
      confirmFeedbackBonusTransactions: async (request) => {
        confirmed.push({ plan: "feedback_bonus", request });
        return {
          ...confirmationResponse,
          feedbackBonus: {
            ...confirmationResponse.feedbackBonus!,
            status: "funded",
            transactionHashes: request.transactionHashes,
          },
        };
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    > &
      Partial<Pick<RateLoopAgentClient, "confirmFeedbackBonusTransactions">>;

    const result = await askHumansWithLocalSigner({
      account,
      agent,
      config: {
        ...validationConfig(),
        chainId: 480,
        chainName: "test",
        pollingIntervalMs: 1,
        receiptTimeoutMs: 1,
      },
      executeTransactionPlan: async ({ calls, plan }) => {
        expect(calls).toHaveLength(plan === "feedback_bonus" ? 2 : 3);
        return { transactionHashes: [...transactions[plan]] };
      },
      onProgress: (event) => {
        progress.push(event);
      },
      payload,
    });

    expect(confirmed).toEqual([
      {
        plan: "ask",
        request: {
          operationKey: operationKeyFor(payload),
          transactionHashes: [...transactions.ask],
        },
      },
      {
        plan: "feedback_bonus",
        request: {
          operationKey: operationKeyFor(payload),
          transactionHashes: [...transactions.feedback_bonus],
        },
      },
    ]);
    expect(result.feedbackBonusConfirmed?.feedbackBonus?.status).toBe("funded");
    expect(result.feedbackBonusTransactions?.transactionHashes).toEqual([
      ...transactions.feedback_bonus,
    ]);
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plan: "ask",
          type: "transactions_confirmed",
        }),
        expect.objectContaining({
          plan: "feedback_bonus",
          type: "transactions_confirmed",
        }),
      ]),
    );
  });

  it("executes same-asset LREP wallet-call Feedback Bonus plans", async () => {
    const payload = feedbackBonusAskPayload();
    payload.bounty.asset = "LREP";
    delete payload.feedbackBonus!.asset;
    payload.paymentMode = "wallet_calls";
    const askResponse = lrepWalletCallsResponse(payload);
    const confirmationResponse = feedbackBonusPlanResponse(payload);
    const transactions = {
      ask: [`0x${"d".repeat(64)}`],
      feedback_bonus: [`0x${"e".repeat(64)}`, `0x${"f".repeat(64)}`],
    } as const;
    const confirmed: unknown[] = [];
    const progress: unknown[] = [];
    const agent = {
      askHumans: async () => askResponse,
      confirmAskTransactions: async (request) => {
        confirmed.push({ plan: "ask", request });
        return confirmationResponse;
      },
      confirmFeedbackBonusTransactions: async (request) => {
        confirmed.push({ plan: "feedback_bonus", request });
        return {
          ...confirmationResponse,
          feedbackBonus: {
            ...confirmationResponse.feedbackBonus!,
            status: "funded",
            transactionHashes: request.transactionHashes,
          },
        };
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    > &
      Partial<Pick<RateLoopAgentClient, "confirmFeedbackBonusTransactions">>;

    const result = await askHumansWithLocalSigner({
      account,
      agent,
      config: {
        ...validationConfig(),
        chainId: 480,
        chainName: "test",
        pollingIntervalMs: 1,
        receiptTimeoutMs: 1,
      },
      executeTransactionPlan: async ({ calls, plan }) => {
        expect(calls).toHaveLength(plan === "feedback_bonus" ? 2 : 3);
        if (plan === "feedback_bonus") {
          expect(calls[0].phase).toBe("approve_feedback_bonus_lrep");
        }
        return { transactionHashes: [...transactions[plan ?? "ask"]] };
      },
      onProgress: (event) => {
        progress.push(event);
      },
      payload,
    });

    expect(confirmed).toEqual([
      {
        plan: "ask",
        request: {
          operationKey: operationKeyFor(payload),
          transactionHashes: [...transactions.ask],
        },
      },
      {
        plan: "feedback_bonus",
        request: {
          operationKey: operationKeyFor(payload),
          transactionHashes: [...transactions.feedback_bonus],
        },
      },
    ]);
    expect(result.feedbackBonusConfirmed?.feedbackBonus?.asset).toBe("LREP");
    expect(result.feedbackBonusConfirmed?.feedbackBonus?.status).toBe("funded");
    expect(result.feedbackBonusTransactions?.transactionHashes).toEqual([
      ...transactions.feedback_bonus,
    ]);
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plan: "feedback_bonus",
          type: "transactions_confirmed",
        }),
      ]),
    );
  });

  it("rejects follow-up Feedback Bonus plans with mismatched pool targets", async () => {
    const payload = feedbackBonusAskPayload();
    payload.paymentMode = "agent_wallet" as never;
    const askResponse = walletCallsResponse();

    for (const scenario of [
      {
        data: feedbackBonusCreatePoolData(payload, {
          contentId: FEEDBACK_BONUS_CONTENT_ID + 1n,
        }),
        expectedError: /contentId must match/,
      },
      {
        data: feedbackBonusCreatePoolData(payload, {
          roundId: FEEDBACK_BONUS_ROUND_ID + 1n,
        }),
        expectedError: /roundId must match/,
      },
      {
        data: feedbackBonusCreatePoolData(payload, {
          feedbackClosesAt: BigInt(feedbackBonusClosesAt()) + 1n,
        }),
        expectedError: /feedbackClosesAt must match/,
      },
    ]) {
      const confirmationResponse = feedbackBonusPlanResponse(payload);
      const feedbackBonusPlan = confirmationResponse.feedbackBonus!
        .transactionPlan as {
        calls: RateLoopAgentWalletTransactionCall[];
        requiresOrderedExecution?: boolean;
      };
      const agent = {
        askHumans: async () => askResponse,
        confirmAskTransactions: async () => ({
          ...confirmationResponse,
          feedbackBonus: {
            ...confirmationResponse.feedbackBonus!,
            transactionPlan: {
              ...feedbackBonusPlan,
              calls: [
                feedbackBonusPlan.calls[0]!,
                {
                  ...feedbackBonusPlan.calls[1]!,
                  data: scenario.data,
                },
              ],
            },
          },
        }),
        confirmFeedbackBonusTransactions: async () => {
          throw new Error("Feedback Bonus plan should not execute.");
        },
      } satisfies Pick<
        RateLoopAgentClient,
        "askHumans" | "confirmAskTransactions"
      > &
        Partial<Pick<RateLoopAgentClient, "confirmFeedbackBonusTransactions">>;

      await expect(
        askHumansWithLocalSigner({
          account,
          agent,
          config: {
            ...validationConfig(),
            chainId: 480,
            chainName: "test",
            pollingIntervalMs: 1,
            receiptTimeoutMs: 1,
          },
          executeTransactionPlan: async ({ plan }) => {
            if (plan === "feedback_bonus") {
              throw new Error("Feedback Bonus plan should not execute.");
            }
            return { transactionHashes: [`0x${"a".repeat(64)}`] };
          },
          payload,
        }),
      ).rejects.toThrow(scenario.expectedError);
    }
  });

  it("rejects bundled Feedback Bonuses before asking the agent", async () => {
    const payload = feedbackBonusAskPayload();
    payload.questions = [
      payload.question!,
      { ...payload.question!, title: "Should this agent wait instead?" },
    ];
    delete payload.question;
    const agent = {
      askHumans: async () => {
        throw new Error("askHumans should not run");
      },
      confirmAskTransactions: async () => {
        throw new Error("confirmAskTransactions should not run");
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    >;

    await expect(
      askHumansWithLocalSigner({
        account,
        agent,
        config: {
          ...validationConfig(),
          chainId: 480,
          chainName: "test",
          pollingIntervalMs: 1,
          receiptTimeoutMs: 1,
        },
        payload,
      }),
    ).rejects.toThrow(/Feedback Bonus funding requires a single-question ask/);
  });

  it("rejects unsafe numeric maxPaymentAmount before asking the agent", async () => {
    const payload = askPayload();
    payload.maxPaymentAmount = Number.MAX_SAFE_INTEGER + 1;
    const agent = {
      askHumans: async () => {
        throw new Error("askHumans should not run");
      },
      confirmAskTransactions: async () => {
        throw new Error("confirmAskTransactions should not run");
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    >;

    await expect(
      askHumansWithLocalSigner({
        account,
        agent,
        config: {
          ...validationConfig(),
          chainId: 480,
          chainName: "test",
          pollingIntervalMs: 1,
          receiptTimeoutMs: 1,
        },
        payload,
        paymentMode: "wallet_calls",
      }),
    ).rejects.toThrow(/maxPaymentAmount must be a safe non-negative integer/);
  });

  it("signs native x402 authorization requests", async () => {
    const paymentAuthorization = await signX402AuthorizationRequest(
      account,
      x402AuthorizationRequest(),
      X402_SIGN_OPTIONS,
    );

    expect(paymentAuthorization).toMatchObject({
      from: account.address,
      nonce: x402PaymentNonce(),
      to: X402_SUBMITTER_ADDRESS,
      validAfter: X402_VALID_AFTER,
      validBefore: X402_VALID_BEFORE,
      value: X402_AMOUNT,
    });
    expect(paymentAuthorization.signature).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("signs native x402 authorization requests for private-forever gated asks", async () => {
    const payload = privateForeverAskPayload();
    const request = x402AuthorizationRequest();
    const nonce = x402PaymentNonceForPayload(payload);
    request.authorization.nonce = nonce;
    request.typedData.message.nonce = nonce;
    const askCalls: AskHumansRequest[] = [];
    const agent = {
      askHumans: async (requestPayload: AskHumansRequest) => {
        askCalls.push(requestPayload);
        return {
          chainId: 480,
          operationKey: operationKeyFor(payload),
          payloadHash: payloadHashFor(payload),
          paymentMode: "x402_authorization",
          status: "awaiting_wallet_signature",
          ...(requestPayload.paymentAuthorization
            ? {}
            : { x402AuthorizationRequest: request }),
        } satisfies AskHumansResponse;
      },
      confirmAskTransactions: async () => {
        throw new Error(
          "confirmAskTransactions should not run without transaction hashes.",
        );
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    >;

    await expect(
      askHumansWithLocalSigner({
        account,
        agent,
        config: {
          chainId: 480,
          chainName: "test",
          contentRegistryAddress: CONTENT_REGISTRY_ADDRESS,
          pollingIntervalMs: 1,
          questionRewardPoolEscrowAddress: QUESTION_REWARD_ESCROW_ADDRESS,
          receiptTimeoutMs: 1,
          usdcAddress: X402_USDC_ADDRESS,
          x402QuestionSubmitterAddress: X402_SUBMITTER_ADDRESS,
        },
        payload,
        paymentMode: "x402_authorization",
      }),
    ).rejects.toThrow(/missing wallet calls/);

    expect(askCalls).toHaveLength(2);
    expect(askCalls[0].question?.confidentiality).toMatchObject({
      disclosurePolicy: "private_forever",
      visibility: "gated",
    });
    expect(askCalls[1].paymentAuthorization?.signature).toMatch(
      /^0x[0-9a-f]{130}$/i,
    );
  });

  it("rejects x402 authorizations for the wrong chain", async () => {
    await expect(
      signX402AuthorizationRequest(account, x402AuthorizationRequest(), {
        ...X402_SIGN_OPTIONS,
        expectedChainId: 4801,
      }),
    ).rejects.toThrow(/does not match local signer chain 4801/);
  });

  it("rejects x402 authorizations with an unexpected typed-data shape", async () => {
    const request = x402AuthorizationRequest();
    request.typedData.primaryType = "Permit";

    await expect(
      signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS),
    ).rejects.toThrow(/primaryType must be ReceiveWithAuthorization/);
  });

  it("accepts Base mainnet x402 authorizations with USDC's USD Coin domain", async () => {
    const request = x402AuthorizationRequest();
    request.typedData.domain.chainId = 8453;
    request.typedData.domain.name = "USD Coin";

    const authorization = await signX402AuthorizationRequest(account, request, {
      ...X402_SIGN_OPTIONS,
      expectedChainId: 8453,
    });

    expect(authorization.signature).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("rejects x402 authorizations for an untrusted USDC contract", async () => {
    const request = x402AuthorizationRequest();
    request.typedData.domain.verifyingContract =
      "0x00000000000000000000000000000000000000dd";

    await expect(
      signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS),
    ).rejects.toThrow(/verifyingContract must be the configured USDC token/);
  });

  it("rejects x402 authorizations when authorization and message differ", async () => {
    const request = x402AuthorizationRequest();
    request.typedData.message.value = "1500001";

    await expect(
      signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS),
    ).rejects.toThrow(/authorization.value must match typedData.message.value/);
  });

  it("rejects x402 authorizations for the wrong submitter or amount", async () => {
    await expect(
      signX402AuthorizationRequest(account, x402AuthorizationRequest(), {
        ...X402_SIGN_OPTIONS,
        expectedAmount: "1500001",
      }),
    ).rejects.toThrow(/value must equal the requested bounty amount/);

    await expect(
      signX402AuthorizationRequest(account, x402AuthorizationRequest(), {
        ...X402_SIGN_OPTIONS,
        expectedX402QuestionSubmitterAddress:
          "0x00000000000000000000000000000000000000dd",
      }),
    ).rejects.toThrow(
      /authorization.to must be the configured RateLoop x402 submitter/,
    );
  });

  it("rejects x402 authorizations with an invalid validity window", async () => {
    const request = x402AuthorizationRequest();
    request.authorization.validBefore = "0";
    request.typedData.message.validBefore = "0";

    await expect(
      signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS),
    ).rejects.toThrow(/validBefore must be greater than validAfter/);
  });

  it("rejects x402 authorizations whose validBefore exceeds the 24 hour cap", async () => {
    const farFuture = String(Math.floor(Date.now() / 1000) + 25 * 60 * 60);
    const request = x402AuthorizationRequest();
    request.authorization.validBefore = farFuture;
    request.typedData.message.validBefore = farFuture;

    await expect(
      signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS),
    ).rejects.toThrow(/validBefore must be within 86400 seconds/);
  });

  it("rejects x402 authorizations whose nonce is not bound to the ask payload", async () => {
    await expect(
      signX402AuthorizationRequest(account, x402AuthorizationRequest(), {
        ...X402_SIGN_OPTIONS,
        expectedNonce: BYTES32_ONE,
      }),
    ).rejects.toThrow(/nonce does not match/);
  });

  it("validates wallet-call transaction plans before execution", () => {
    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: walletCallsResponse(),
      config: validationConfig(),
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
      expectedPayload: askPayload(),
    });

    expect(calls).toHaveLength(3);
  });

  it("validates LREP bounty wallet-call transaction plans before execution", () => {
    const payload = {
      ...askPayload(),
      bounty: {
        ...askPayload().bounty,
        asset: "LREP" as const,
      },
    };
    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: lrepWalletCallsResponse(payload),
      config: validationConfig(),
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
      expectedPayload: payload,
    });

    expect(calls).toHaveLength(3);
  });

  it("uses the server metadata base when validating local signer ask hashes", () => {
    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: walletCallsResponse({}, QUESTION_METADATA_BASE_URL),
      config: validationConfig(),
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
      expectedPayload: askPayload(),
    });

    expect(calls).toHaveLength(3);
  });

  it("normalizes inherited public metadata base env values with server fallback semantics", () => {
    const config = loadLocalSignerConfig({}, {
      NEXT_PUBLIC_PONDER_URL: "http://localhost:42069",
    } as NodeJS.ProcessEnv);

    expect(config.questionMetadataBaseUrl).toBeUndefined();
    expect(config.questionMetadataBaseUrlPinned).toBe(false);
  });

  it("rejects remote plaintext local signer RPC URLs", () => {
    expect(() =>
      loadLocalSignerConfig({}, {
        RATELOOP_RPC_URL: "http://rpc.example.test",
      } as NodeJS.ProcessEnv),
    ).toThrow(/RATELOOP_RPC_URL must use HTTPS/);

    expect(() =>
      loadLocalSignerConfig(
        {
          "rpc-url": "http://rpc.example.test",
        },
        {} as NodeJS.ProcessEnv,
      ),
    ).toThrow(/--rpc-url must use HTTPS/);
  });

  it("allows HTTPS and loopback HTTP local signer RPC URLs", () => {
    expect(
      loadLocalSignerConfig({}, {
        RATELOOP_RPC_URL: "https://rpc.example.test/",
      } as NodeJS.ProcessEnv).rpcUrl,
    ).toBe("https://rpc.example.test");

    expect(
      loadLocalSignerConfig({}, {
        RATELOOP_RPC_URL: "http://127.0.0.1:8545/",
      } as NodeJS.ProcessEnv).rpcUrl,
    ).toBe("http://127.0.0.1:8545");
  });

  it("lets server metadata bases override inherited public env fallbacks", () => {
    const config = loadLocalSignerConfig({}, {
      NEXT_PUBLIC_APP_URL: "https://app.example",
    } as NodeJS.ProcessEnv);

    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: walletCallsResponse({}, QUESTION_METADATA_BASE_URL),
      config: {
        ...validationConfig(),
        questionMetadataBaseUrl: config.questionMetadataBaseUrl,
        questionMetadataBaseUrlPinned: config.questionMetadataBaseUrlPinned,
      },
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
      expectedPayload: askPayload(),
    });

    expect(calls).toHaveLength(3);
  });

  it("uses chain-scoped USDC aliases when validating local signer plans", () => {
    const unscopedUsdcAddress =
      "0x0000000000000000000000000000000000000123" as const;
    const config = loadLocalSignerConfig({}, {
      RATELOOP_X402_USDC_ADDRESS: unscopedUsdcAddress,
      RATELOOP_X402_USDC_ADDRESS_480: X402_USDC_ADDRESS,
    } as NodeJS.ProcessEnv);

    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: walletCallsResponse({}, QUESTION_METADATA_BASE_URL),
      config: {
        ...validationConfig(),
        usdcAddress: config.usdcAddress,
        usdcAddressesByChain: config.usdcAddressesByChain,
      },
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
      expectedPayload: askPayload(),
    });

    expect(calls).toHaveLength(3);
  });

  it("rejects disagreeing chain-scoped USDC aliases", () => {
    expect(() =>
      loadLocalSignerConfig({}, {
        RATELOOP_LOCAL_SIGNER_USDC_ADDRESS_480: X402_USDC_ADDRESS,
        RATELOOP_X402_USDC_ADDRESS_480:
          "0x0000000000000000000000000000000000000123",
      } as NodeJS.ProcessEnv),
    ).toThrow(/must match when both are set/);
  });

  it("rejects server metadata bases that differ from the local signer pin", () => {
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: walletCallsResponse({}, QUESTION_METADATA_BASE_URL),
        config: {
          ...validationConfig(),
          questionMetadataBaseUrl: "https://operator.example",
        },
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/does not match local signer questionMetadataBaseUrl/);
  });

  it("validates signed x402 transaction plans before execution", () => {
    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: x402CallsResponse(),
      config: validationConfig(),
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
      expectedPaymentAuthorization: signedX402Authorization(),
      expectedPayload: askPayload(),
    });

    expect(calls).toHaveLength(1);
  });

  it("validates one-shot x402 plans with USDC Feedback Bonus funding", () => {
    const payload = feedbackBonusAskPayload();
    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: x402OneShotCallsResponse(payload),
      config: validationConfig(),
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
      expectedPaymentAuthorization: signedOneShotX402Authorization(payload),
      expectedPayload: payload,
    });

    expect(calls).toHaveLength(1);
  });

  it("rejects transaction plans whose submission calldata differs from the ask payload", () => {
    const changedTitleData = encodeFunctionData({
      abi: ContentRegistrySubmitQuestionWithConfidentialityAbi,
      args: [
        QUESTION_CONTEXT_URL,
        [],
        "",
        "Changed question title",
        QUESTION_TAG,
        1n,
        EMPTY_DETAILS,
        expectedSalt(),
        rewardTerms(),
        roundConfig(),
        questionSpec(),
        ZERO_CONFIDENTIALITY_CONFIG,
      ],
      functionName: "submitQuestionWithRewardAndRoundConfig",
    });

    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: walletCallsResponse({
          transactionPlan: {
            ...walletCallsResponse().transactionPlan,
            calls: [
              walletCallsResponse().transactionPlan!.calls![0]!,
              walletCallsResponse().transactionPlan!.calls![1]!,
              {
                ...walletCallsResponse().transactionPlan!.calls![2]!,
                data: changedTitleData,
              },
            ],
            requiresOrderedExecution: true,
          },
        }),
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/title must match/);
  });

  it("rejects transaction plans with reserve commitments not derived from the ask payload", () => {
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: walletCallsResponse({
          transactionPlan: {
            ...walletCallsResponse().transactionPlan,
            calls: [
              {
                ...walletCallsResponse().transactionPlan!.calls![0]!,
                data: reserveSubmissionData(BYTES32_ONE),
              },
              walletCallsResponse().transactionPlan!.calls![1]!,
              walletCallsResponse().transactionPlan!.calls![2]!,
            ],
            requiresOrderedExecution: true,
          },
        }),
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/revealCommitment must match/);
  });

  it("rejects x402 transaction plans that do not use the exact signed authorization", () => {
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: x402CallsResponse(),
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPaymentAuthorization: {
          ...signedX402Authorization(),
          signature: `0x${"2".repeat(64)}${"4".repeat(64)}1c`,
        },
        expectedPayload: askPayload(),
      }),
    ).toThrow(/paymentAuthorization.r must match/);
  });

  it("rejects transaction plans with untrusted targets or spend amounts", () => {
    const wrongTarget = walletCallsResponse({
      transactionPlan: {
        ...walletCallsResponse().transactionPlan,
        calls: [
          walletCallsResponse().transactionPlan!.calls![0]!,
          {
            ...walletCallsResponse().transactionPlan!.calls![1]!,
            to: "0x00000000000000000000000000000000000000ff",
          },
          walletCallsResponse().transactionPlan!.calls![2]!,
        ],
        requiresOrderedExecution: true,
      },
    });
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: wrongTarget,
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/to must be/);

    const wrongAmount = walletCallsResponse({
      transactionPlan: {
        ...walletCallsResponse().transactionPlan,
        calls: [
          walletCallsResponse().transactionPlan!.calls![0]!,
          {
            ...walletCallsResponse().transactionPlan!.calls![1]!,
            data: encodeFunctionData({
              abi: erc20Abi,
              args: [QUESTION_REWARD_ESCROW_ADDRESS, BigInt(X402_AMOUNT) + 1n],
              functionName: "approve",
            }),
          },
          walletCallsResponse().transactionPlan!.calls![2]!,
        ],
        requiresOrderedExecution: true,
      },
    });
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: wrongAmount,
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/approve amount must equal/);
  });

  it("rejects transaction plans with unknown selectors or mismatched wallets", () => {
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: walletCallsResponse({
          wallet: { address: "0x00000000000000000000000000000000000000ff" },
        }),
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/does not match local signer/);

    const badSelector = x402CallsResponse({
      transactionPlan: {
        ...x402CallsResponse().transactionPlan,
        calls: [
          {
            ...x402CallsResponse().transactionPlan!.calls![0]!,
            data: reserveSubmissionData(),
          },
        ],
        requiresOrderedExecution: true,
      },
    });
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: badSelector,
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPaymentAuthorization: signedX402Authorization(),
        expectedPayload: askPayload(),
      }),
    ).toThrow(/unexpected function selector/);
  });

  it("rejects empty transaction plans after x402 resubmit", async () => {
    const askCalls: AskHumansRequest[] = [];
    const agent = {
      askHumans: async (
        request: AskHumansRequest,
      ): Promise<AskHumansResponse> => {
        askCalls.push(request);
        if (!request.paymentAuthorization) {
          return {
            operationKey: expectedOperationKey(),
            payloadHash: expectedPayloadHash(),
            paymentMode: "x402_authorization",
            x402AuthorizationRequest: x402AuthorizationRequest(),
          };
        }

        return {
          operationKey: expectedOperationKey(),
          paymentMode: "x402_authorization",
          transactionPlan: { calls: [], requiresOrderedExecution: true },
        };
      },
      confirmAskTransactions: async () => {
        throw new Error(
          "confirmAskTransactions should not run without transaction hashes.",
        );
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    >;

    await expect(
      askHumansWithLocalSigner({
        account,
        agent,
        config: {
          chainId: 480,
          chainName: "test",
          contentRegistryAddress: CONTENT_REGISTRY_ADDRESS,
          pollingIntervalMs: 1,
          questionRewardPoolEscrowAddress: QUESTION_REWARD_ESCROW_ADDRESS,
          receiptTimeoutMs: 1,
          usdcAddress: X402_USDC_ADDRESS,
          x402QuestionSubmitterAddress: X402_SUBMITTER_ADDRESS,
        },
        payload: askPayload(),
        paymentMode: "x402_authorization",
      }),
    ).rejects.toThrow(/missing wallet calls/);

    expect(askCalls).toHaveLength(2);
    expect(askCalls[1].paymentAuthorization?.signature).toMatch(
      /^0x[0-9a-f]{130}$/i,
    );
  });

  it("rejects x402 authorization asks whose server metadata base differs from the local signer pin", async () => {
    const agent = {
      askHumans: async (): Promise<AskHumansResponse> => ({
        operationKey: expectedOperationKey(QUESTION_METADATA_BASE_URL),
        payloadHash: expectedPayloadHash(QUESTION_METADATA_BASE_URL),
        paymentMode: "x402_authorization",
        questionMetadataBaseUrl: QUESTION_METADATA_BASE_URL,
        x402AuthorizationRequest: x402AuthorizationRequest(),
      }),
      confirmAskTransactions: async () => {
        throw new Error(
          "confirmAskTransactions should not run before authorization signing.",
        );
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    >;

    await expect(
      askHumansWithLocalSigner({
        account,
        agent,
        config: {
          chainId: 480,
          chainName: "test",
          contentRegistryAddress: CONTENT_REGISTRY_ADDRESS,
          pollingIntervalMs: 1,
          questionMetadataBaseUrl: "https://operator.example",
          questionRewardPoolEscrowAddress: QUESTION_REWARD_ESCROW_ADDRESS,
          receiptTimeoutMs: 1,
          usdcAddress: X402_USDC_ADDRESS,
          x402QuestionSubmitterAddress: X402_SUBMITTER_ADDRESS,
        },
        payload: askPayload(),
        paymentMode: "x402_authorization",
      }),
    ).rejects.toThrow(/does not match local signer questionMetadataBaseUrl/);
  });

  it("rejects ask payloads that target a different configured chain", async () => {
    const agent = {
      askHumans: async () => {
        throw new Error("askHumans should not run for a chain mismatch.");
      },
      confirmAskTransactions: async () => {
        throw new Error(
          "confirmAskTransactions should not run for a chain mismatch.",
        );
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    >;

    await expect(
      askHumansWithLocalSigner({
        account,
        agent,
        config: {
          chainId: 480,
          chainName: "test",
          pollingIntervalMs: 1,
          receiptTimeoutMs: 1,
        },
        payload: {
          ...askPayload(),
          chainId: 4801,
        },
      }),
    ).rejects.toThrow(/chainId 4801 does not match local signer chain 480/);
  });
});

function fiveVoterAskPayload(
  overrides: Partial<AskHumansRequest> = {},
): AskHumansRequest {
  const base = askPayload();
  const { bounty, ...restOverrides } = overrides;
  return {
    ...base,
    bounty: { ...base.bounty, requiredVoters: "5", ...bounty },
    roundConfig: undefined,
    ...restOverrides,
  };
}

describe("local signer round config alignment", () => {
  it("defaults roundConfig.minVoters to bounty.requiredVoters when omitted", () => {
    const canonical = buildLocalQuestionCanonicalPayload(
      fiveVoterAskPayload(),
      480,
    );

    expect(canonical.roundConfig).toEqual({
      questionDurationSeconds: "1200",
      minVoters: "5",
      maxVoters: "100",
    });
    expect(canonical.bounty.requiredVoters).toBe("5");
  });

  it("raises the default maxVoters when requiredVoters exceeds it", () => {
    const payload = fiveVoterAskPayload();
    payload.bounty.requiredVoters = "150";

    const canonical = buildLocalQuestionCanonicalPayload(payload, 480);

    expect(canonical.roundConfig).toEqual({
      questionDurationSeconds: "1200",
      minVoters: "150",
      maxVoters: "150",
    });
  });

  it("accepts an explicit roundConfig that matches bounty.requiredVoters", () => {
    const canonical = buildLocalQuestionCanonicalPayload(
      fiveVoterAskPayload({
        roundConfig: {
          questionDurationSeconds: "1200",
          maxVoters: "100",
          minVoters: "5",
        },
      }),
      480,
    );

    expect(canonical.roundConfig).toEqual({
      questionDurationSeconds: "1200",
      minVoters: "5",
      maxVoters: "100",
    });
  });

  it("rejects round config values that overflow ABI widths", () => {
    const tooManyRequiredVoters = fiveVoterAskPayload();
    tooManyRequiredVoters.bounty.requiredVoters = "65536";

    expect(() =>
      buildLocalQuestionCanonicalPayload(tooManyRequiredVoters, 480),
    ).toThrow(/bounty\.requiredVoters must be at most 65535/);

    expect(() =>
      buildLocalQuestionCanonicalPayload(
        fiveVoterAskPayload({
          roundConfig: {
            questionDurationSeconds: "4294967296",
            maxVoters: "100",
            minVoters: "5",
          },
        }),
        480,
      ),
    ).toThrow(
      /question\.roundConfig\.questionDurationSeconds must be at most 4294967295/,
    );
  });

  it("expands the pure-agent fast round preset into a contract-safe round config", () => {
    const canonical = buildLocalQuestionCanonicalPayload(
      fiveVoterAskPayload({
        roundPreset: "pure_agent_fast",
      }),
      480,
    );

    expect(canonical.roundConfig).toEqual({
      questionDurationSeconds: "60",
      minVoters: "5",
      maxVoters: "5",
    });
  });

  it("rejects ambiguous round presets combined with explicit round config", () => {
    expect(() =>
      buildLocalQuestionCanonicalPayload(
        fiveVoterAskPayload({
          roundConfig: {
            questionDurationSeconds: "1200",
            maxVoters: "100",
            minVoters: "5",
          },
          roundPreset: "pure_agent_fast",
        }),
        480,
      ),
    ).toThrow(/roundPreset cannot be combined with question\.roundConfig/);
  });

  it("binds gated confidentiality into the canonical payload", () => {
    const canonical = buildLocalQuestionCanonicalPayload(
      fiveVoterAskPayload({
        question: {
          categoryId: "1",
          confidentiality: {
            bond: {
              amount: "1000000",
              asset: "LREP",
            },
            disclosurePolicy: "private_until_settlement",
            visibility: "gated",
          },
          detailsHash: `0x${"4".repeat(64)}`,
          detailsUrl:
            "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop",
          tags: [QUESTION_TAG],
          title: QUESTION_TITLE,
        },
      }),
      480,
    );

    expect(canonical.questions[0].confidentiality).toEqual({
      bond: {
        amount: "1000000",
        asset: "LREP",
      },
      disclosurePolicy: "after_settlement",
      visibility: "gated",
    });
    expect(canonical.questions[0].contextUrl).toBe("");
  });

  it("defaults omitted gated disclosure policy to private forever", () => {
    const canonical = buildLocalQuestionCanonicalPayload(
      fiveVoterAskPayload({
        question: {
          categoryId: "1",
          confidentiality: {
            visibility: "gated",
          },
          detailsHash: `0x${"4".repeat(64)}`,
          detailsUrl:
            "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop",
          tags: [QUESTION_TAG],
          title: QUESTION_TITLE,
        },
      }),
      480,
    );

    expect(canonical.questions[0].confidentiality.disclosurePolicy).toBe(
      "private_forever",
    );
  });

  it("rejects dust gated confidentiality bonds", () => {
    expect(() =>
      buildLocalQuestionCanonicalPayload(
        fiveVoterAskPayload({
          question: {
            categoryId: "1",
            confidentiality: {
              bond: {
                amount: "1",
                asset: "LREP",
              },
              visibility: "gated",
            },
            detailsHash: `0x${"4".repeat(64)}`,
            detailsUrl:
              "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop",
            tags: [QUESTION_TAG],
            title: QUESTION_TITLE,
          },
        }),
        480,
      ),
    ).toThrow(
      /questions\[0\]\.confidentiality\.bond\.amount must be 0 or at least 1000000 atomic units/,
    );
  });

  it("rejects oversized gated confidentiality bonds", () => {
    expect(() =>
      buildLocalQuestionCanonicalPayload(
        fiveVoterAskPayload({
          question: {
            categoryId: "1",
            confidentiality: {
              bond: {
                amount: "18446744073709551616",
                asset: "LREP",
              },
              visibility: "gated",
            },
            detailsHash: `0x${"4".repeat(64)}`,
            detailsUrl:
              "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop",
            tags: [QUESTION_TAG],
            title: QUESTION_TITLE,
          },
        }),
        480,
      ),
    ).toThrow(
      /questions\[0\]\.confidentiality\.bond\.amount must be at most 18446744073709551615/,
    );
  });

  it("rejects an explicit roundConfig.minVoters that mismatches bounty.requiredVoters", () => {
    expect(() =>
      buildLocalQuestionCanonicalPayload(
        fiveVoterAskPayload({
          roundConfig: {
            questionDurationSeconds: "1200",
            maxVoters: "100",
            minVoters: "3",
          },
        }),
      ),
    ).toThrow(
      /question\.roundConfig\.minVoters must match bounty\.requiredVoters/,
    );
  });

  it("keeps the shipped five-voter examples aligned with the round quorum", () => {
    const exampleFiles = [
      "agent-trace-review.json",
      "feature-acceptance-test.json",
      "generated-mockup-feedback.json",
      "ai-website-feedback-service.json",
    ];

    for (const fileName of exampleFiles) {
      const example = JSON.parse(
        readFileSync(
          new URL(`../../examples/questions/${fileName}`, import.meta.url),
          "utf8",
        ),
      );

      const canonical = buildLocalQuestionCanonicalPayload(example);
      expect(canonical.bounty.requiredVoters).toBe("5");
      expect(canonical.roundConfig.minVoters).toBe("5");
      expect(BigInt(canonical.roundConfig.maxVoters)).toBeGreaterThanOrEqual(
        5n,
      );
    }
  });
});

describe("local signer media canonicalization", () => {
  it("matches the shared x402 parser canonical payload byte-for-byte", () => {
    const base = askPayload();
    const payload = {
      ...base,
      question: {
        ...base.question,
        contextUrl: undefined,
        imageUrls: [
          UPLOADED_IMAGE_URL_B,
          UPLOADED_IMAGE_URL_A,
          UPLOADED_IMAGE_URL_A,
        ],
      },
    };
    const options = { questionMetadataBaseUrl: QUESTION_METADATA_BASE_URL };

    expect(buildLocalQuestionCanonicalPayload(payload, 480, options)).toEqual(
      toCanonicalQuestionPayload(
        parseX402QuestionRequest(payload, 480, options),
        options,
      ),
    );
  });

  it("sorts and deduplicates image URLs before hashing local asks", () => {
    const canonical = buildLocalQuestionCanonicalPayload(
      {
        ...askPayload(),
        question: {
          ...askPayload().question,
          imageUrls: [
            UPLOADED_IMAGE_URL_B,
            UPLOADED_IMAGE_URL_A,
            UPLOADED_IMAGE_URL_A,
          ],
        },
      },
      480,
    );

    expect(canonical.questions[0].imageUrls).toEqual([
      UPLOADED_IMAGE_URL_A,
      UPLOADED_IMAGE_URL_B,
    ]);
  });

  it("accepts path-prefixed RateLoop image attachment URLs", () => {
    const base = askPayload();
    const parsed = parseX402QuestionRequest(
      {
        ...base,
        question: {
          ...base.question,
          contextUrl: undefined,
          imageUrls: [UPLOADED_IMAGE_URL_PREFIXED],
        },
      },
      480,
    );

    expect(parsed.questions[0].imageUrls).toEqual([
      UPLOADED_IMAGE_URL_PREFIXED,
    ]);
  });

  it("accepts localhost HTTP RateLoop attachment URLs when localhost attachments are enabled", () => {
    const base = askPayload();
    const parsed = parseX402QuestionRequest(
      {
        ...base,
        question: {
          ...base.question,
          contextUrl: undefined,
          detailsHash: `0x${"4".repeat(64)}`,
          detailsUrl: LOCALHOST_DETAILS_URL,
          imageUrls: [LOCALHOST_UPLOADED_IMAGE_URL],
        },
      },
      480,
      {
        allowLocalhostAttachmentOrigins: true,
        questionMetadataBaseUrl: QUESTION_METADATA_BASE_URL,
      },
    );

    expect(parsed.questions[0].detailsUrl).toBe(LOCALHOST_DETAILS_URL);
    expect(parsed.questions[0].imageUrls).toEqual([
      LOCALHOST_UPLOADED_IMAGE_URL,
    ]);
  });

  it("rejects localhost HTTP RateLoop attachment URLs when localhost attachments are disabled", () => {
    const base = askPayload();

    expect(() =>
      parseX402QuestionRequest(
        {
          ...base,
          question: {
            ...base.question,
            contextUrl: undefined,
            imageUrls: [LOCALHOST_UPLOADED_IMAGE_URL],
          },
        },
        480,
        { allowLocalhostAttachmentOrigins: false },
      ),
    ).toThrow(/imageUrls must come from RateLoop uploads/);

    expect(() =>
      parseX402QuestionRequest(
        {
          ...base,
          question: {
            ...base.question,
            detailsHash: `0x${"4".repeat(64)}`,
            detailsUrl: LOCALHOST_DETAILS_URL,
          },
        },
        480,
        { allowLocalhostAttachmentOrigins: false },
      ),
    ).toThrow(/detailsUrl must be an HTTPS URL/);
  });
});

describe("x402 head-to-head parser validation", () => {
  it("rejects head-to-head asks without option metadata", () => {
    const base = askPayload();

    expect(() =>
      parseX402QuestionRequest(
        {
          ...base,
          templateId: "head_to_head_ab",
          question: {
            ...base.question,
            title: "Do you prefer A = Codex or B = Claude?",
            templateId: "head_to_head_ab",
          },
        },
        480,
      ),
    ).toThrow(/templateInputs must include valid optionAKey/);
  });

  it("rejects bundled head-to-head asks", () => {
    const base = askPayload();
    const templateInputs = {
      optionAKey: "A",
      optionALabel: "Codex",
      optionBKey: "B",
      optionBLabel: "Claude",
    };

    expect(() =>
      parseX402QuestionRequest(
        {
          ...base,
          question: undefined,
          questions: [
            {
              ...base.question,
              title: "Do you prefer A = Codex or B = Claude?",
              templateId: "head_to_head_ab",
              templateInputs,
            },
            {
              ...base.question,
              title: "Should this agent proceed with the fallback plan?",
            },
          ],
        },
        480,
      ),
    ).toThrow(/head_to_head_ab supports exactly one question/);
  });
});
