import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  X402QuestionInputError,
  buildX402QuestionOperation,
  parseX402QuestionRequest,
} from "~~/lib/x402/questionPayload";

const UPLOADED_IMAGE_URL =
  "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const UPLOADED_IMAGE_URL_B =
  "https://www.rateloop.ai/api/attachments/images/att_bcdefghijklmnopq.webp#sha256=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DETAILS_URL = "https://www.rateloop.ai/api/attachments/details/det_questiondetails01";
const DETAILS_HASH = `0x${"8".repeat(64)}`;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}`;
const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalNextPublicAppUrl = env.NEXT_PUBLIC_APP_URL;
const originalNodeEnv = env.NODE_ENV;
const originalVercelUrl = env.VERCEL_URL;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

afterEach(() => {
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("VERCEL_URL", originalVercelUrl);
});

const VALID_REQUEST = {
  bounty: {
    amount: "1000000",
    asset: "USDC",
    requiredVoters: "3",
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
  roundConfig: {
    maxVoters: "50",
    minVoters: "3",
    questionDurationSeconds: "1200",
  },
};

test("parseX402QuestionRequest normalizes a valid paid question payload", () => {
  const payload = parseX402QuestionRequest(VALID_REQUEST);

  assert.equal(payload.chainId, 480);
  assert.equal(payload.questions.length, 1);
  assert.equal(payload.questions[0].contextUrl, "https://example.com/watch?v=abc123");
  assert.equal(payload.bounty.amount, 1_000_000n);
  assert.equal(payload.bounty.bountyStartBy, 0n);
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

test("parseX402QuestionRequest rejects unsafe numeric atomic fields", () => {
  const unsafeInteger = Number.MAX_SAFE_INTEGER + 1;

  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: {
          ...VALID_REQUEST.bounty,
          amount: unsafeInteger,
        },
      }),
    /bounty\.amount must be a safe non-negative integer/,
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: {
          ...VALID_REQUEST.bounty,
          bountyEligibility: unsafeInteger,
        },
      }),
    /bounty\.bountyEligibility must be a safe non-negative integer/,
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          categoryId: unsafeInteger,
        },
      }),
    /questions\[0\]\.categoryId must be a safe non-negative integer/,
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          confidentiality: {
            bond: {
              amount: unsafeInteger,
              asset: "LREP",
            },
            visibility: "gated",
          },
          contextUrl: undefined,
          detailsHash: DETAILS_HASH,
          detailsUrl: DETAILS_URL,
          imageUrls: [UPLOADED_IMAGE_URL],
          videoUrl: undefined,
        },
      }),
    /questions\[0\]\.confidentiality\.bond\.amount must be a safe non-negative integer/,
  );
});

test("parseX402QuestionRequest accepts dry-run control fields", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    dryRun: true,
    executionMode: "dry_run",
    sandbox: true,
  });

  assert.equal(payload.clientRequestId, VALID_REQUEST.clientRequestId);
  assert.equal(payload.questions.length, 1);
});

test("parseX402QuestionRequest canonicalizes image URL order and duplicates", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      imageUrls: [UPLOADED_IMAGE_URL_B, UPLOADED_IMAGE_URL, UPLOADED_IMAGE_URL],
    },
  });

  assert.deepEqual(payload.questions[0].imageUrls, [UPLOADED_IMAGE_URL, UPLOADED_IMAGE_URL_B]);
});

test("parseX402QuestionRequest ignores unsafe configured app origins for uploaded images in production", () => {
  env.NODE_ENV = "production";
  env.APP_URL = "https://evil.example";
  delete env.NEXT_PUBLIC_APP_URL;

  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          imageUrls: [
            `https://evil.example/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0x${"a".repeat(64)}`,
          ],
        },
      }),
    /imageUrls must come from RateLoop uploads/,
  );
  env.NEXT_PUBLIC_APP_URL = "https://safe.rateloop.ai";
  assert.deepEqual(
    parseX402QuestionRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        imageUrls: [
          `https://safe.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0x${"a".repeat(64)}`,
        ],
      },
    }).questions[0].imageUrls,
    [`https://safe.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0x${"a".repeat(64)}`],
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          confidentiality: {
            bond: {
              amount: "1000000",
              asset: "LREP",
            },
            visibility: "gated",
          },
          contextUrl: undefined,
          detailsHash: DETAILS_HASH,
          detailsUrl: "https://evil.example/api/attachments/details/det_questiondetails01",
          imageUrls: [],
        },
      }),
    /detailsUrl must be a RateLoop-hosted details attachment/,
  );
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

test("parseX402QuestionRequest accepts gated RateLoop-hosted context", () => {
  const publicPayload = parseX402QuestionRequest(VALID_REQUEST);
  const gatedPayload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      confidentiality: {
        bond: {
          amount: "1000000",
          asset: "LREP",
        },
        disclosurePolicy: "private_forever",
        visibility: "gated",
      },
      contextUrl: undefined,
      detailsHash: DETAILS_HASH,
      detailsUrl: DETAILS_URL,
      imageUrls: [UPLOADED_IMAGE_URL],
      videoUrl: undefined,
    },
  });

  assert.deepEqual(gatedPayload.questions[0].confidentiality, {
    bond: {
      amount: "1000000",
      asset: "LREP",
    },
    disclosurePolicy: "private_forever",
    visibility: "gated",
  });
  assert.equal(gatedPayload.questions[0].contextUrl, "");
  assert.notEqual(gatedPayload.questions[0].questionMetadataHash, publicPayload.questions[0].questionMetadataHash);
  assert.notEqual(
    buildX402QuestionOperation(gatedPayload).payloadHash,
    buildX402QuestionOperation(publicPayload).payloadHash,
  );
});

test("parseX402QuestionRequest defaults omitted gated disclosure policy to private forever", () => {
  const gatedPayload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      confidentiality: {
        visibility: "gated",
      },
      contextUrl: undefined,
      detailsHash: DETAILS_HASH,
      detailsUrl: DETAILS_URL,
      imageUrls: [UPLOADED_IMAGE_URL],
      videoUrl: undefined,
    },
  });

  assert.equal(gatedPayload.questions[0].confidentiality.disclosurePolicy, "private_forever");
  assert.equal(
    (
      gatedPayload.questions[0].questionMetadata as {
        confidentiality?: { disclosurePolicy?: string };
      }
    ).confidentiality?.disclosurePolicy,
    "private_forever",
  );
});

test("parseX402QuestionRequest rejects dust confidentiality bonds", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          confidentiality: {
            bond: {
              amount: "1",
              asset: "LREP",
            },
            visibility: "gated",
          },
          contextUrl: undefined,
          detailsHash: DETAILS_HASH,
          detailsUrl: DETAILS_URL,
          imageUrls: [UPLOADED_IMAGE_URL],
          videoUrl: undefined,
        },
      }),
    /bond\.amount must be 0 or at least 1000000 atomic units/,
  );
});

test("parseX402QuestionRequest rejects oversized confidentiality bonds", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          confidentiality: {
            bond: {
              amount: "18446744073709551616",
              asset: "LREP",
            },
            visibility: "gated",
          },
          contextUrl: undefined,
          detailsHash: DETAILS_HASH,
          detailsUrl: DETAILS_URL,
          imageUrls: [UPLOADED_IMAGE_URL],
          videoUrl: undefined,
        },
      }),
    /bond\.amount must be at most 18446744073709551615/,
  );
});

test("parseX402QuestionRequest rejects external context for gated questions", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          confidentiality: {
            visibility: "gated",
          },
        },
      }),
    /external contextUrl and videoUrl are not allowed/,
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          confidentiality: {
            visibility: "gated",
          },
          contextUrl: undefined,
          imageUrls: [],
          videoUrl: "https://www.youtube.com/watch?v=abc123",
        },
      }),
    /external contextUrl and videoUrl are not allowed/,
  );
});

test("parseX402QuestionRequest rejects gated questions without hosted details", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          confidentiality: {
            visibility: "gated",
          },
          contextUrl: undefined,
          detailsHash: undefined,
          detailsUrl: undefined,
          imageUrls: [UPLOADED_IMAGE_URL],
          videoUrl: undefined,
        },
      }),
    /detailsUrl is required for gated questions/,
  );
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

test("parseX402QuestionRequest ignores legacy description input", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    question: {
      ...VALID_REQUEST.question,
      description: "Legacy voter summary",
    },
  });

  assert.ok(!("description" in payload.questions[0]));
});

test("parseX402QuestionRequest accepts ordered question bundles", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: {
      ...VALID_REQUEST.bounty,
      requiredVoters: "5",
    },
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
      questionDurationSeconds: "600",
      minVoters: "5",
      maxVoters: "50",
    },
  });

  assert.equal(payload.questions.length, 2);
  assert.equal(payload.questions[1].title, "Would you pay for this?");
  assert.equal(payload.questions[1].tags, "Market,Research");
  assert.equal(payload.bounty.requiredVoters, 5n);
  assert.equal(payload.roundConfig.minVoters, 5n);
  assert.equal(payload.roundConfig.maxVoters, 50n);
});

test("parseX402QuestionRequest rejects gated question bundles", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: undefined,
        questions: [
          {
            ...VALID_REQUEST.question,
            confidentiality: { visibility: "gated" },
            contextUrl: undefined,
            detailsHash: DETAILS_HASH,
            detailsUrl: DETAILS_URL,
            imageUrls: [UPLOADED_IMAGE_URL],
            videoUrl: undefined,
          },
          {
            ...VALID_REQUEST.question,
            contextUrl: "https://example.com/second",
            imageUrls: [],
            title: "Public sibling",
          },
        ],
      }),
    /Private context bundles are not supported yet/,
  );
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
        countries: ["de"],
        expertise: ["ai"],
        languages: ["de", "en", "de"],
        roles: ["engineer"],
      },
    },
  });

  assert.deepEqual(withAudience.questions[0].targetAudience, {
    countries: ["DE"],
    expertise: ["ai"],
    languages: ["de", "en"],
    roles: ["engineer"],
  });
  assert.notEqual(withAudience.questions[0].questionMetadataHash, withoutAudience.questions[0].questionMetadataHash);
  assert.notEqual(
    buildX402QuestionOperation(withAudience).payloadHash,
    buildX402QuestionOperation(withoutAudience).payloadHash,
  );
});

test("parseX402QuestionRequest rejects target audience aliases with suggestions", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          targetAudience: {
            roles: ["developer"],
          },
        },
      }),
    (error: unknown) =>
      error instanceof X402QuestionInputError &&
      /questions\[0\]\.targetAudience\.roles/.test(error.message) &&
      /developer/.test(error.message) &&
      /engineer/.test(error.message),
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
    bounty: {
      ...VALID_REQUEST.bounty,
      requiredVoters: "5",
    },
    roundConfig: {
      questionDurationSeconds: "600",
      minVoters: "5",
      maxVoters: "50",
    },
  });

  assert.equal(payload.roundConfig.epochDuration, 600n);
  assert.equal(payload.roundConfig.maxDuration, 600n);
  assert.equal(payload.roundConfig.minVoters, 5n);
  assert.equal(payload.roundConfig.maxVoters, 50n);
});

test("parseX402QuestionRequest rejects round config ABI-width overflows", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: {
          ...VALID_REQUEST.bounty,
          requiredVoters: "65536",
        },
      }),
    /bounty\.requiredVoters must be at most 65535/,
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        roundConfig: {
          questionDurationSeconds: "4294967296",
          maxVoters: "100",
          minVoters: "3",
        },
      }),
    /question\.roundConfig\.questionDurationSeconds must be at most 4294967295/,
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        roundConfig: {
          questionDurationSeconds: "1200",
          maxVoters: "65536",
          minVoters: "3",
        },
      }),
    /question\.roundConfig\.maxVoters must be at most 65535/,
  );
});

test("parseX402QuestionRequest defaults settlement voters to bounty voters", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: {
      ...VALID_REQUEST.bounty,
      requiredVoters: "5",
    },
    roundConfig: {
      ...VALID_REQUEST.roundConfig,
      minVoters: "5",
    },
  });

  assert.equal(payload.bounty.requiredVoters, 5n);
  assert.equal(payload.roundConfig.minVoters, 5n);
  assert.equal(payload.roundConfig.maxVoters, 50n);
});

test("parseX402QuestionRequest enforces bounty-size voter floors", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: {
          ...VALID_REQUEST.bounty,
          amount: "1000000000",
          requiredVoters: "3",
        },
      }),
    /requiredVoters must be at least 5/,
  );

  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: {
          ...VALID_REQUEST.bounty,
          amount: "10000000000",
          requiredVoters: "5",
        },
        roundConfig: {
          ...VALID_REQUEST.roundConfig,
          minVoters: "5",
        },
      }),
    /requiredVoters must be at least 8/,
  );

  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: {
      ...VALID_REQUEST.bounty,
      amount: "10000000000",
      requiredVoters: "8",
    },
    roundConfig: {
      ...VALID_REQUEST.roundConfig,
      minVoters: "8",
    },
  });
  assert.equal(payload.bounty.requiredVoters, 8n);
  assert.equal(payload.roundConfig.minVoters, 8n);
});

test("parseX402QuestionRequest defaults large bounties to open eligibility", () => {
  const defaulted = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: {
      ...VALID_REQUEST.bounty,
      amount: "500000000",
    },
  });
  assert.equal(defaulted.bounty.bountyEligibility, 0);

  const explicitOpen = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: {
      ...VALID_REQUEST.bounty,
      amount: "500000000",
      bountyEligibility: "0",
    },
  });
  assert.equal(explicitOpen.bounty.bountyEligibility, 0);

  const explicitHuman = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: {
      ...VALID_REQUEST.bounty,
      amount: "500000000",
      bountyEligibility: "8",
    },
  });
  assert.equal(explicitHuman.bounty.bountyEligibility, 8);
});

test("parseX402QuestionRequest rejects bounty and round voter mismatches", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: {
          ...VALID_REQUEST.bounty,
          requiredVoters: "5",
        },
        roundConfig: {
          questionDurationSeconds: "600",
          minVoters: "3",
          maxVoters: "50",
        },
      }),
    /minVoters must match bounty.requiredVoters/,
  );
});

test("buildX402QuestionOperation binds round config into the payload hash", () => {
  const first = buildX402QuestionOperation(parseX402QuestionRequest(VALID_REQUEST));
  const second = buildX402QuestionOperation(
    parseX402QuestionRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        requiredVoters: "5",
      },
      roundConfig: {
        questionDurationSeconds: "600",
        minVoters: "5",
        maxVoters: "50",
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
        bountyEligibility: "8",
      },
    }),
  );

  assert.notEqual(first.operationKey, second.operationKey);
  assert.notEqual(first.payloadHash, second.payloadHash);
});

test("parseX402QuestionRequest uses the configured Ponder URL for canonical metadata URIs", () => {
  const previousPonderUrl = process.env.NEXT_PUBLIC_PONDER_URL;
  const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_PONDER_URL = "https://ponder.rateloop.ai";
  delete process.env.NEXT_PUBLIC_APP_URL;
  try {
    const operation = buildX402QuestionOperation(parseX402QuestionRequest(VALID_REQUEST));

    assert.match(
      operation.canonicalPayload.questions[0].questionMetadataUri,
      /^https:\/\/ponder\.rateloop\.ai\/question-metadata\/0x[a-f0-9]{64}$/,
    );
  } finally {
    if (previousPonderUrl === undefined) {
      delete process.env.NEXT_PUBLIC_PONDER_URL;
    } else {
      process.env.NEXT_PUBLIC_PONDER_URL = previousPonderUrl;
    }
    if (previousAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
    }
  }
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

test("parseX402QuestionRequest accepts LREP agent bounties for wallet-call submissions", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: { ...VALID_REQUEST.bounty, asset: "LREP" },
  });

  assert.equal(payload.bounty.asset, "LREP");
});

test("parseX402QuestionRequest rejects user-supplied settled-round bounty requests", () => {
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: { ...VALID_REQUEST.bounty, requiredSettledRounds: "2" },
      }),
    /bounty\.requiredSettledRounds is no longer accepted/,
  );
});

test("parseX402QuestionRequest accepts Proof of Human bounty scope", () => {
  const payload = parseX402QuestionRequest({
    ...VALID_REQUEST,
    bounty: {
      ...VALID_REQUEST.bounty,
      bountyEligibility: "8",
    },
  });

  assert.equal(payload.bounty.bountyEligibility, 8);
});

test("parseX402QuestionRequest rejects unsupported bounty scopes", () => {
  for (const bountyEligibility of ["1", "4", "140"]) {
    assert.throws(
      () =>
        parseX402QuestionRequest({
          ...VALID_REQUEST,
          bounty: {
            ...VALID_REQUEST.bounty,
            bountyEligibility,
          },
        }),
      /bountyEligibility must be 0 for everyone or 8 for Proof of Human/,
    );
  }
});

test("parseX402QuestionRequest normalizes omitted bounty timing to the question duration", () => {
  const payload = parseX402QuestionRequest(VALID_REQUEST);

  assert.equal(payload.bounty.bountyStartBy, 0n);
  assert.equal(payload.bounty.bountyWindowSeconds, payload.roundConfig.maxDuration);
  assert.equal(payload.bounty.feedbackWindowSeconds, payload.roundConfig.maxDuration);

  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: { ...VALID_REQUEST.bounty, bountyStartBy: "1" },
      }),
    /bounty\.bountyStartBy is no longer accepted/,
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: { ...VALID_REQUEST.bounty, bountyWindowSeconds: "600" },
      }),
    /bounty\.bountyWindowSeconds is no longer accepted/,
  );
  assert.throws(
    () =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        bounty: { ...VALID_REQUEST.bounty, feedbackWindowSeconds: "600" },
      }),
    /bounty\.feedbackWindowSeconds is no longer accepted/,
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
