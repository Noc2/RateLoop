import assert from "node:assert/strict";
import test from "node:test";
import {
  X402QuestionInputError,
  buildX402QuestionOperation,
  parseX402QuestionRequest,
} from "~~/lib/x402/questionPayload";

const UPLOADED_IMAGE_URL =
  "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DETAILS_URL = "https://www.rateloop.ai/api/attachments/details/det_questiondetails01";
const DETAILS_HASH = `0x${"8".repeat(64)}`;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}`;

const VALID_REQUEST = {
  bounty: {
    amount: "1000000",
    asset: "USDC",
    requiredSettledRounds: "1",
    requiredVoters: "3",
    bountyStartBy: "1762000000",
    bountyWindowSeconds: "1200",
    feedbackWindowSeconds: "1200",
  },
  chainId: 480,
  clientRequestId: "youtube:abc123",
  question: {
    categoryId: "5",
    contextUrl: "https://example.com/watch?v=abc123",
    description: "Vote based on the source material and the prompt.",
    imageUrls: [UPLOADED_IMAGE_URL],
    tags: ["Media", "Video"],
    title: "Is this clip worth watching?",
  },
};

test("parseX402QuestionRequest normalizes a valid paid question payload", () => {
  const payload = parseX402QuestionRequest(VALID_REQUEST);

  assert.equal(payload.chainId, 480);
  assert.equal(payload.questions.length, 1);
  assert.equal(payload.questions[0].contextUrl, "https://example.com/watch?v=abc123");
  assert.equal(payload.bounty.amount, 1_000_000n);
  assert.equal(payload.bounty.bountyStartBy, 1_762_000_000n);
  assert.equal(payload.bounty.bountyWindowSeconds, 1_200n);
  assert.equal(payload.bounty.feedbackWindowSeconds, 1_200n);
  assert.equal(payload.bounty.requiredVoters, 3n);
  assert.equal(payload.bounty.bountyEligibility, 0);
  assert.equal(payload.roundConfig.epochDuration, 1200n);
  assert.equal(payload.questions[0].tags, "Media,Video");
  assert.equal(payload.questions[0].detailsHash, EMPTY_DETAILS_HASH);
  assert.equal(payload.questions[0].detailsUrl, "");
  assert.deepEqual(payload.questions[0].imageUrls, [UPLOADED_IMAGE_URL]);
});

test("parseX402QuestionRequest accepts off-chain details URL and hash", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      detailsHash: DETAILS_HASH,
      detailsUrl: DETAILS_URL,
    },
  });

  assert.equal(payload.questions[0].detailsHash, DETAILS_HASH);
  assert.equal(payload.questions[0].detailsUrl, DETAILS_URL);
  const operation = buildX402QuestionOperation(payload);
  assert.equal(operation.canonicalPayload.questions[0].detailsHash, DETAILS_HASH);
  assert.equal(operation.canonicalPayload.questions[0].detailsUrl, DETAILS_URL);
});

test("parseX402QuestionRequest requires details URL and hash together", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          detailsUrl: DETAILS_URL,
        },
      }),
    /detailsHash is required/,
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          detailsHash: DETAILS_HASH,
        },
      }),
    /detailsUrl is required/,
  );
});

test("parseX402QuestionRequest rejects credentialed details URLs", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          detailsHash: DETAILS_HASH,
          detailsUrl: "https://user:pass@example.com/details.txt",
        },
      }),
    /must not include credentials/,
  );
});

test("parseX402QuestionRequest accepts image-only question context", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      contextUrl: undefined,
      imageUrls: [UPLOADED_IMAGE_URL],
    },
  });

  assert.equal(payload.questions[0].contextUrl, "");
  assert.deepEqual(payload.questions[0].imageUrls, [UPLOADED_IMAGE_URL]);
});

test("parseX402QuestionRequest accepts video-only question context", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      contextUrl: undefined,
      imageUrls: [],
      videoUrl: "https://www.youtube.com/watch?v=abc123",
    },
  });

  assert.equal(payload.questions[0].contextUrl, "");
  assert.deepEqual(payload.questions[0].imageUrls, []);
  assert.equal(payload.questions[0].videoUrl, "https://www.youtube.com/watch?v=abc123");
});

test("parseX402QuestionRequest rejects arbitrary HTTPS image URLs", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          imageUrls: ["https://example.com/mockup.png"],
        },
      }),
    /rateloop_upload_image/,
  );
});

test("parseX402QuestionRequest rejects direct image file context URLs", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          contextUrl: "https://example.com/mockup.webp?variant=1",
        },
      }),
    /public HTTPS page URL/,
  );
});

test("parseX402QuestionRequest rejects uploaded image paths on untrusted origins", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          imageUrls: [
            "https://evil.example/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ],
        },
      }),
    /rateloop_upload_image/,
  );
});

test("parseX402QuestionRequest accepts an omitted description", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      description: undefined,
    },
  });

  assert.equal(payload.questions[0].description, "");
});

test("parseX402QuestionRequest accepts ordered question bundles", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: undefined,
    questions: [
      VALID_REQUEST.question,
      {
        ...VALID_REQUEST.question,
        contextUrl: "https://example.com/second",
        imageUrls: [],
        tags: ["Market", "Research"],
        title: "Would you pay for this?",
      },
    ],
    roundConfig: {
      epochDuration: "600",
      maxDuration: "7200",
      minVoters: "5",
      maxVoters: "50",
    },
  });

  assert.equal(payload.questions.length, 2);
  assert.equal(payload.questions[1].title, "Would you pay for this?");
  assert.equal(payload.questions[1].tags, "Market,Research");
  assert.equal(payload.roundConfig.maxVoters, 50n);
});

test("parseX402QuestionRequest preserves selected agent templates in hashes", () => {
  const generic = parseX402QuestionRequest(VALID_REQUEST);
  const goNoGo = parseX402QuestionRequest({
    ...VALID_REQUEST,
    templateId: "go_no_go",
    templateInputs: {
      action: "send_outreach",
    },
  });

  assert.equal(goNoGo.questions[0].templateId, "go_no_go");
  assert.equal(goNoGo.questions[0].templateVersion, 1);
  assert.deepEqual(goNoGo.questions[0].templateInputs, { action: "send_outreach" });
  assert.notEqual(goNoGo.questions[0].questionMetadataHash, generic.questions[0].questionMetadataHash);
  assert.notEqual(goNoGo.questions[0].resultSpecHash, generic.questions[0].resultSpecHash);
});

test("parseX402QuestionRequest anchors feature acceptance template metadata", () => {
  const generic = parseX402QuestionRequest(VALID_REQUEST);
  const featureAcceptance = parseX402QuestionRequest({
    ...VALID_REQUEST,
    templateId: "feature_acceptance_test",
    templateInputs: {
      acceptanceCriteria: "Vote up only if connect, refresh, and vote all work without manual recovery.",
      expectedBehavior: "The wallet stays connected after refresh.",
      testSteps: "1. Open preview. 2. Connect wallet. 3. Refresh. 4. Confirm wallet remains connected.",
    },
  });

  assert.equal(featureAcceptance.questions[0].templateId, "feature_acceptance_test");
  assert.equal(featureAcceptance.questions[0].templateVersion, 1);
  assert.deepEqual(featureAcceptance.questions[0].templateInputs, {
    acceptanceCriteria: "Vote up only if connect, refresh, and vote all work without manual recovery.",
    expectedBehavior: "The wallet stays connected after refresh.",
    testSteps: "1. Open preview. 2. Connect wallet. 3. Refresh. 4. Confirm wallet remains connected.",
  });
  assert.notEqual(featureAcceptance.questions[0].questionMetadataHash, generic.questions[0].questionMetadataHash);
  assert.notEqual(featureAcceptance.questions[0].resultSpecHash, generic.questions[0].resultSpecHash);
});

test("parseX402QuestionRequest binds public target audience metadata into the payload", () => {
  const withoutAudience = parseX402QuestionRequest(VALID_REQUEST);
  const withAudience = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      targetAudience: {
        expertise: ["developer", "founder"],
        roles: ["operator"],
      },
    },
  });

  assert.deepEqual(withAudience.questions[0].targetAudience, {
    expertise: ["developer", "founder"],
    roles: ["operator"],
  });
  assert.notEqual(withAudience.questions[0].questionMetadataHash, withoutAudience.questions[0].questionMetadataHash);
  assert.notEqual(
    buildX402QuestionOperation(withAudience).payloadHash,
    buildX402QuestionOperation(withoutAudience).payloadHash,
  );
});

test("parseX402QuestionRequest supports per-question template overrides in bundles", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: undefined,
    templateId: "generic_rating",
    questions: [
      {
        ...VALID_REQUEST.question,
        templateId: "go_no_go",
      },
      {
        ...VALID_REQUEST.question,
        contextUrl: "https://example.com/second",
        imageUrls: [],
        tags: ["Market", "Research"],
        templateId: "ranked_option_member",
        templateInputs: {
          comparisonSetId: "headline-test-1",
          optionId: "variant-a",
          optionLabel: "Hero variant A",
        },
        title: "Would you pay for this?",
      },
    ],
  });

  assert.equal(payload.questions[0].templateId, "go_no_go");
  assert.equal(payload.questions[1].templateId, "ranked_option_member");
  assert.deepEqual(payload.questions[1].templateInputs, {
    comparisonSetId: "headline-test-1",
    optionId: "variant-a",
    optionLabel: "Hero variant A",
  });
});

test("parseX402QuestionRequest rejects unknown or unsupported template versions", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        templateId: "mystery_template",
      }),
    /templateId is not supported/,
  );

  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        templateId: "go_no_go",
        templateVersion: 2,
      }),
    /templateVersion 2 is not supported/,
  );
});

test("parseX402QuestionRequest accepts explicit governed round config", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      roundConfig: {
        epochDuration: "600",
        maxDuration: "7200",
        minVoters: "5",
        maxVoters: "50",
      },
    },
  });

  assert.equal(payload.roundConfig.epochDuration, 600n);
  assert.equal(payload.roundConfig.maxDuration, 7200n);
  assert.equal(payload.roundConfig.minVoters, 5n);
  assert.equal(payload.roundConfig.maxVoters, 50n);
});

test("buildX402QuestionOperation binds round config into the payload hash", () => {
  const first = buildX402QuestionOperation(parseX402QuestionRequest(VALID_REQUEST));
  const second = buildX402QuestionOperation(
    parseX402QuestionRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        roundConfig: {
          epochDuration: "600",
          maxDuration: "7200",
          minVoters: "5",
          maxVoters: "50",
        },
      },
    }),
  );

  assert.notEqual(first.operationKey, second.operationKey);
  assert.notEqual(first.payloadHash, second.payloadHash);
});

test("buildX402QuestionOperation binds bounty eligibility into the payload hash", () => {
  const first = buildX402QuestionOperation(parseX402QuestionRequest(VALID_REQUEST));
  const second = buildX402QuestionOperation(
    parseX402QuestionRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        bountyEligibility: "4",
      },
    }),
  );

  assert.notEqual(first.operationKey, second.operationKey);
  assert.notEqual(first.payloadHash, second.payloadHash);
});

test("buildX402QuestionOperation is sensitive to bundle question order", () => {
  const first = buildX402QuestionOperation(
    parseX402QuestionRequest({
      ...VALID_REQUEST,
      question: undefined,
      questions: [
        VALID_REQUEST.question,
        { ...VALID_REQUEST.question, contextUrl: "https://example.com/second", title: "Second title" },
      ],
    }),
  );
  const second = buildX402QuestionOperation(
    parseX402QuestionRequest({
      ...VALID_REQUEST,
      question: undefined,
      questions: [
        { ...VALID_REQUEST.question, contextUrl: "https://example.com/second", title: "Second title" },
        VALID_REQUEST.question,
      ],
    }),
  );

  assert.notEqual(first.operationKey, second.operationKey);
  assert.notEqual(first.payloadHash, second.payloadHash);
});

test("buildX402QuestionOperation is stable for equivalent payloads", () => {
  const first = buildX402QuestionOperation(parseX402QuestionRequest(VALID_REQUEST));
  const second = buildX402QuestionOperation(parseX402QuestionRequest({ ...VALID_REQUEST }));

  assert.equal(first.operationKey, second.operationKey);
  assert.equal(first.payloadHash, second.payloadHash);
});

test("parseX402QuestionRequest rejects non-USDC x402 bounties", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: { ...VALID_REQUEST.bounty, asset: "LREP" },
      }),
    X402QuestionInputError,
  );
});

test("parseX402QuestionRequest accepts bundle payouts with multiple settled rounds", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: { ...VALID_REQUEST.bounty, requiredSettledRounds: "2" },
  });

  assert.equal(payload.bounty.requiredSettledRounds, 2n);
});

test("parseX402QuestionRequest accepts multi-credential bounty scopes with recent recheck", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: {
      ...VALID_REQUEST.bounty,
      bountyEligibility: "140",
    },
  });

  assert.equal(payload.bounty.bountyEligibility, 140);
});

test("parseX402QuestionRequest rejects unsupported bounty scopes", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: {
          ...VALID_REQUEST.bounty,
          bountyEligibility: "1",
        },
      }),
    /bountyEligibility must be 0 or a supported credential bitmask/,
  );
});

test("parseX402QuestionRequest rejects bundle payouts without a start-by deadline", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: { ...VALID_REQUEST.bounty, bountyStartBy: "0" },
      }),
    /must be greater than zero/,
  );
});

test("parseX402QuestionRequest rejects unsupported media combinations before payment", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          videoUrl: "https://www.youtube.com/watch?v=abc123",
        },
      }),
    /Use imageUrls or videoUrl/,
  );
});

test("parseX402QuestionRequest requires public context media", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          contextUrl: undefined,
          imageUrls: [],
        },
      }),
    /contextUrl, imageUrls, or videoUrl is required/,
  );
});
