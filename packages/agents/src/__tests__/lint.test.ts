import { describe, expect, it } from "vitest";
import { lintAgentAskRequest, summarizeLintFindings } from "../questions/lint.js";

const UPLOADED_IMAGE_URL =
  "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LOCALHOST_UPLOADED_IMAGE_URL =
  "http://localhost:3000/api/attachments/images/att_localhostimage01.webp#sha256=0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const DETAILS_URL = "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop";
const LOCALHOST_DETAILS_URL = "http://localhost:3000/api/attachments/details/det_localhostdetails01";
const DETAILS_HASH = `0x${"4".repeat(64)}`;

const VALID_REQUEST = {
  bounty: {
    amount: "1000000",
    requiredVoters: "3",
  },
  chainId: 8453,
  clientRequestId: "landing-pitch-demo",
  question: {
    categoryId: "1",
    contextUrl: "https://example.com/landing-page",
    description: "Vote up only if the linked pitch is clear, credible, and interesting enough to keep reading.",
    tags: ["agent", "pitch"],
    templateId: "generic_rating",
    title: "Would this pitch make you want to learn more?",
  },
};

describe("agent question linting", () => {
  it("accepts a focused agent ask", () => {
    const findings = lintAgentAskRequest(VALID_REQUEST);

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("accepts omitted legacy bounty timing fields", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: {
        amount: "1000000",
        requiredVoters: "3",
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("rejects missing or unsafe chain ids before quote or submission", () => {
    const { chainId: _chainId, ...withoutChainId } = VALID_REQUEST;

    expect(lintAgentAskRequest(withoutChainId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "chainId must be a positive base-10 safe integer.",
          path: "chainId",
        }),
      ]),
    );

    for (const chainId of [0, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "8453abc"]) {
      const findings = lintAgentAskRequest({ ...VALID_REQUEST, chainId });
      expect(findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "error",
            path: "chainId",
          }),
        ]),
      );
    }
  });

  it("validates maxPaymentAmount when present and requires it for spend paths", () => {
    expect(
      lintAgentAskRequest(VALID_REQUEST, { requireMaxPaymentAmount: true }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "maxPaymentAmount is required before an agent can spend.",
          path: "maxPaymentAmount",
        }),
      ]),
    );

    const invalidFindings = lintAgentAskRequest({
      ...VALID_REQUEST,
      maxPaymentAmount: Number.MAX_SAFE_INTEGER + 1,
    });
    expect(invalidFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "maxPaymentAmount",
        }),
      ]),
    );

    expect(
      summarizeLintFindings(
        lintAgentAskRequest({
          ...VALID_REQUEST,
          maxPaymentAmount: "1000000",
        }, { requireMaxPaymentAmount: true }),
      ).ok,
    ).toBe(true);
  });

  it("accepts supported reward assets while preserving defaulted blanks", () => {
    for (const request of [
      {
        ...VALID_REQUEST,
        bounty: {
          ...VALID_REQUEST.bounty,
          asset: "lrep",
        },
        feedbackBonus: {
          amount: "1000000",
          asset: "usdc",
        },
      },
      {
        ...VALID_REQUEST,
        bounty: {
          ...VALID_REQUEST.bounty,
          asset: " ",
        },
        feedbackBonus: {
          amount: "1000000",
          asset: "",
        },
      },
    ]) {
      const findings = lintAgentAskRequest(request);

      expect(summarizeLintFindings(findings)).toEqual({
        errorCount: 0,
        ok: true,
        warningCount: 0,
      });
    }
  });

  it("rejects unsupported reward assets before server submission", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        asset: "ETH",
      },
      feedbackBonus: {
        amount: "1000000",
        asset: 1,
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "bounty.asset must be USDC or LREP.",
          path: "bounty.asset",
        }),
        expect.objectContaining({
          level: "error",
          message: "feedbackBonus.asset must be USDC or LREP.",
          path: "feedbackBonus.asset",
        }),
      ]),
    );
    expect(summarizeLintFindings(findings).ok).toBe(false);
  });

  it("rejects missing or invalid Feedback Bonus amounts before server submission", () => {
    for (const amount of [undefined, "0", 0, "-1", "1.5", "1000junk", Number.MAX_SAFE_INTEGER + 1]) {
      const findings = lintAgentAskRequest({
        ...VALID_REQUEST,
        feedbackBonus: {
          amount,
          asset: "USDC",
        },
      });

      expect(findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "error",
            message: "Feedback Bonus amount must be a positive atomic integer.",
            path: "feedbackBonus.amount",
          }),
        ]),
      );
      expect(summarizeLintFindings(findings).ok).toBe(false);
    }
  });

  it("rejects legacy timing fields in authored asks", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        requiredSettledRounds: "1",
        bountyStartBy: "0",
        bountyWindowSeconds: "1200",
        feedbackWindowSeconds: "1200",
      },
      feedbackBonus: {
        amount: "1000000",
        feedbackClosesAt: "1200",
      },
      roundConfig: {
        epochDuration: "1200",
        maxDuration: "1200",
        minVoters: "3",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "bounty.requiredSettledRounds" }),
        expect.objectContaining({ path: "bounty.bountyStartBy" }),
        expect.objectContaining({ path: "bounty.bountyWindowSeconds" }),
        expect.objectContaining({ path: "bounty.feedbackWindowSeconds" }),
        expect.objectContaining({ path: "feedbackBonus.feedbackClosesAt" }),
        expect.objectContaining({ path: "roundConfig.epochDuration" }),
        expect.objectContaining({ path: "roundConfig.maxDuration" }),
      ]),
    );
    expect(summarizeLintFindings(findings).ok).toBe(false);
  });

  it("rejects unsafe numeric atomic fields", () => {
    const unsafeInteger = Number.MAX_SAFE_INTEGER + 1;
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        amount: unsafeInteger,
      },
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
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "bounty.amount",
        }),
        expect.objectContaining({
          level: "error",
          path: "question.confidentiality.bond.amount",
        }),
      ]),
    );
  });

  it("accepts public image context without a context URL", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        contextUrl: undefined,
        imageUrls: [UPLOADED_IMAGE_URL],
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("accepts public video context without a context URL", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        contextUrl: undefined,
        imageUrls: [],
        videoUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("rejects public asks that mix image and video context", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        contextUrl: undefined,
        imageUrls: [UPLOADED_IMAGE_URL],
        videoUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "Use imageUrls or videoUrl, not both.",
          path: "question.imageUrls",
        }),
      ]),
    );
  });

  it("accepts gated hosted context and warns about public titles", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        confidentiality: {
          disclosurePolicy: "after_settlement",
          visibility: "gated",
        },
        contextUrl: undefined,
        detailsHash: DETAILS_HASH,
        detailsUrl: DETAILS_URL,
        imageUrls: [UPLOADED_IMAGE_URL],
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 1,
    });
    expect(findings).toEqual([
      expect.objectContaining({
        level: "warning",
        path: "question.title",
      }),
    ]);
  });

  it("rejects external context on gated questions", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        confidentiality: {
          visibility: "gated",
        },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "question.confidentiality.visibility",
        }),
      ]),
    );
  });

  it("warns when gated questions use a nonzero bond", () => {
    const findings = lintAgentAskRequest({
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
        detailsUrl: DETAILS_URL,
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          path: "question.confidentiality.bond.amount",
        }),
      ]),
    );
  });

  it("rejects dust gated confidentiality bonds", () => {
    const findings = lintAgentAskRequest({
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
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: expect.stringContaining("at least 1000000 atomic units"),
          path: "question.confidentiality.bond.amount",
        }),
      ]),
    );
  });

  it("rejects oversized gated confidentiality bonds", () => {
    const findings = lintAgentAskRequest({
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
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: expect.stringContaining("at most 18446744073709551615 atomic units"),
          path: "question.confidentiality.bond.amount",
        }),
      ]),
    );
  });

  it("accepts public HTTPS details URLs with matching hashes", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        detailsHash: DETAILS_HASH,
        detailsUrl: DETAILS_URL,
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("accepts localhost HTTP RateLoop attachment URLs in local lint mode", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        contextUrl: undefined,
        detailsHash: DETAILS_HASH,
        detailsUrl: LOCALHOST_DETAILS_URL,
        imageUrls: [LOCALHOST_UPLOADED_IMAGE_URL],
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("rejects details URLs with embedded credentials", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        detailsHash: DETAILS_HASH,
        detailsUrl: "https://user:pass@www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: "error", path: "question.detailsUrl" })]),
    );
  });

  it("rejects arbitrary HTTPS image URLs", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        imageUrls: ["https://example.com/mockup.png"],
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: "error", path: "question.imageUrls" })]),
    );
  });

  it("rejects more than four uploaded image URLs", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        contextUrl: undefined,
        imageUrls: [UPLOADED_IMAGE_URL, UPLOADED_IMAGE_URL, UPLOADED_IMAGE_URL, UPLOADED_IMAGE_URL, UPLOADED_IMAGE_URL],
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "imageUrls supports at most 4 images.",
          path: "question.imageUrls",
        }),
      ]),
    );
  });

  it("rejects direct image file context URLs", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        contextUrl: "https://example.com/mockup.png",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: "error", path: "question.contextUrl" })]),
    );
  });

  it("rejects missing context, unknown templates, and non-idempotent requests", () => {
    const findings = lintAgentAskRequest({
      bounty: { amount: "0" },
      clientRequestId: "x",
      question: {
        ...VALID_REQUEST.question,
        contextUrl: "http://example.com",
        templateId: "invented",
        title: "Is this clear? Is it trustworthy?",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "error", path: "clientRequestId" }),
        expect.objectContaining({ level: "error", path: "bounty.amount" }),
        expect.objectContaining({ level: "error", path: "question.contextUrl" }),
        expect.objectContaining({ level: "error", path: "question.templateId" }),
        expect.objectContaining({ level: "warning", path: "question.title" }),
      ]),
    );
  });

  it("rejects asks without public context media", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        contextUrl: undefined,
        imageUrls: [],
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "Context URL, RateLoop-hosted details URL, image URL, or video URL is required.",
          path: "question.contextUrl",
        }),
      ]),
    );
  });

  it("reports malformed public context fields instead of throwing", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        imageUrls: "https://example.com/image.png",
        tags: { topic: "agent" },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "error", path: "question.imageUrls" }),
        expect.objectContaining({ level: "error", path: "question.tags" }),
      ]),
    );
  });

  it("rejects asks with more than three public tags", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        tags: "sports, world-cup-2026, public-opinion, debate",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "At most 3 tags are supported.",
          path: "question.tags",
        }),
      ]),
    );
  });

  it("rejects bundles with more than ten questions", () => {
    const questions = Array.from({ length: 11 }, (_, index) => ({
      ...VALID_REQUEST.question,
      title: `Is option ${index + 1} ready for review?`,
    }));

    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: undefined,
      questions,
      templateId: "ranked_option_member",
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "At most 10 questions are supported.",
          path: "questions",
        }),
      ]),
    );
  });

  it("warns when ranked option questions imply hidden selectable answers", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: undefined,
      questions: [
        {
          ...VALID_REQUEST.question,
          templateInputs: {
            comparisonSetId: "answer-review-1",
            optionId: "answer-a",
            optionLabel: "Answer A",
          },
          templateId: "ranked_option_member",
          title: "Which answer gives the safest recommendation?",
        },
      ],
      templateId: "ranked_option_member",
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          path: "questions.0.title",
        }),
      ]),
    );
  });

  it("warns when generic asks look like unsupported multiple-choice surveys", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        description:
          "Main answer options: Yes, Maybe, No. Follow-up: choose from these price ranges and explain your answer.",
        title: "Would you use this AI website service?",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          path: "question.description",
        }),
      ]),
    );
  });

  it("warns when single-question asks hide option selection in the title", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        description: "Review the mockups and pick the strongest direction.",
        title: "Which direction would you choose for this website?",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          path: "question.title",
        }),
      ]),
    );
  });

  it("accepts pairwise output bundles without ranked-option warnings", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: undefined,
      questions: [
        {
          ...VALID_REQUEST.question,
          templateId: "pairwise_output_preference",
          title: "Rate answer A for the refund response",
        },
        {
          ...VALID_REQUEST.question,
          templateId: "pairwise_output_preference",
          title: "Rate answer B for the refund response",
        },
      ],
      templateId: "pairwise_output_preference",
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("nudges feature acceptance asks toward concrete test instructions", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        templateId: "feature_acceptance_test",
        title: "Does this wallet preview work as specified?",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          path: "question.templateInputs.expectedBehavior",
        }),
        expect.objectContaining({
          level: "warning",
          path: "question.templateInputs.testSteps",
        }),
        expect.objectContaining({
          level: "warning",
          path: "question.templateInputs.acceptanceCriteria",
        }),
      ]),
    );
  });

  it("accepts feature acceptance asks with test steps and acceptance criteria", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        templateId: "feature_acceptance_test",
        templateInputs: {
          acceptanceCriteria: "Vote up only if connect, refresh, and vote all work without manual recovery.",
          expectedBehavior: "The wallet stays connected after refresh.",
          testSteps: "1. Open preview. 2. Connect wallet. 3. Refresh. 4. Confirm wallet remains connected.",
        },
        title: "Does this wallet preview work as specified?",
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("nudges agent trace reviews toward concrete trace context", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        templateId: "agent_trace_review",
        title: "Was this agent trace reasonable?",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          path: "question.templateInputs.traceId",
        }),
        expect.objectContaining({
          level: "warning",
          path: "question.templateInputs.taskGoal",
        }),
        expect.objectContaining({
          level: "warning",
          path: "question.templateInputs.reviewFocus",
        }),
      ]),
    );
  });

  it("accepts agent trace reviews with trace id, task goal, and review focus", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        templateId: "agent_trace_review",
        templateInputs: {
          reviewFocus: "Tool choice, evidence use, and final answer safety.",
          taskGoal: "Answer why a customer refund has not arrived.",
          traceId: "run-refund-42",
        },
        title: "Was this agent trace reasonable?",
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });
});

describe("round config voter alignment linting", () => {
  it("accepts explicit open eligibility for large bounties", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        amount: "500000000",
        bountyEligibility: "0",
      },
    });

    expect(summarizeLintFindings(findings).ok).toBe(true);
  });

  it("accepts omitted eligibility for large bounties", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        amount: "500000000",
      },
    });

    expect(summarizeLintFindings(findings).ok).toBe(true);
  });

  it("rejects unsupported bounty eligibility values", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        bountyEligibility: "7",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "bounty.bountyEligibility",
        }),
      ]),
    );
  });

  it("rejects non-integer bounty eligibility values", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        bountyEligibility: "proof_of_human",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "bounty.bountyEligibility",
        }),
      ]),
    );
  });

  it("accepts an explicit roundConfig.minVoters that matches bounty.requiredVoters", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: { ...VALID_REQUEST.bounty, requiredVoters: "5" },
      roundConfig: {
        questionDurationSeconds: "1200",
        maxVoters: "100",
        minVoters: "5",
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("flags an explicit roundConfig.minVoters that mismatches bounty.requiredVoters", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: { ...VALID_REQUEST.bounty, requiredVoters: "5" },
      roundConfig: {
        questionDurationSeconds: "1200",
        maxVoters: "100",
        minVoters: "3",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "roundConfig.minVoters",
        }),
      ]),
    );
    expect(summarizeLintFindings(findings).ok).toBe(false);
  });

  it("flags round config values that overflow ABI widths", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: { ...VALID_REQUEST.bounty, requiredVoters: "65536" },
      roundConfig: {
        questionDurationSeconds: "4294967296",
        maxVoters: "65536",
        minVoters: "65536",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "bounty.requiredVoters",
        }),
        expect.objectContaining({
          level: "error",
          path: "roundConfig.questionDurationSeconds",
        }),
        expect.objectContaining({
          level: "error",
          path: "roundConfig.minVoters",
        }),
        expect.objectContaining({
          level: "error",
          path: "roundConfig.maxVoters",
        }),
      ]),
    );
  });

  it("flags a question-level roundConfig.minVoters mismatch against the default quorum", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: { amount: "1000000" },
      question: {
        ...VALID_REQUEST.question,
        roundConfig: { minVoters: "5" },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "question.roundConfig.minVoters",
        }),
      ]),
    );
  });

  it("accepts omitted roundConfig values", () => {
    expect(
      summarizeLintFindings(
        lintAgentAskRequest({
          ...VALID_REQUEST,
          bounty: { ...VALID_REQUEST.bounty, requiredVoters: "5" },
        }),
      ).ok,
    ).toBe(true);
  });

  it("flags non-numeric roundConfig voter values", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      roundConfig: { minVoters: "not-a-number" },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "roundConfig.minVoters",
        }),
      ]),
    );
  });

  it("rejects unsupported round presets and roundPreset plus roundConfig", () => {
    const invalidPresetFindings = lintAgentAskRequest({
      ...VALID_REQUEST,
      roundPreset: "slow_review",
    });
    expect(invalidPresetFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "roundPreset",
        }),
      ]),
    );

    const combinedPresetFindings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        roundPreset: "pure_agent_fast",
      },
      roundConfig: { minVoters: "3" },
    });
    expect(combinedPresetFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "question.roundPreset",
        }),
      ]),
    );
  });

  it("rejects invalid structured target audience values", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        targetAudience: { roles: ["developer"] },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "question.targetAudience",
        }),
      ]),
    );
  });

  it("accepts a valid head-to-head A/B ask", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      templateId: "head_to_head_ab",
      question: {
        ...VALID_REQUEST.question,
        templateId: "head_to_head_ab",
        title: "Do you prefer A = Codex or B = Claude?",
        description: "Choose A (Codex) or B (Claude). One pick per rater.",
        templateInputs: {
          optionAKey: "A",
          optionALabel: "Codex",
          optionBKey: "B",
          optionBLabel: "Claude",
        },
      },
    });

    expect(summarizeLintFindings(findings)).toEqual({
      errorCount: 0,
      ok: true,
      warningCount: 0,
    });
  });

  it("rejects explicit Option A/B comparisons that stay on generic rating", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        title: "Vote up for Option A: Hermes Agent over Option B: OpenClaw for RateLoop agent loops.",
        description:
          "Vote up for Option A, Hermes Agent, if you would choose it over OpenClaw. Vote down for Option B, OpenClaw.",
        templateId: "generic_rating",
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: expect.stringContaining("head_to_head_ab"),
          path: "question.templateId",
        }),
      ]),
    );
  });

  it("rejects titles missing option markers on head-to-head asks", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      templateId: "head_to_head_ab",
      question: {
        ...VALID_REQUEST.question,
        templateId: "head_to_head_ab",
        title: "A vs B — which agent do you prefer for coding work?",
        templateInputs: {
          optionAKey: "A",
          optionALabel: "Codex",
          optionBKey: "B",
          optionBLabel: "Claude",
        },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "question.title",
        }),
      ]),
    );
  });

  it("rejects vote-up-if titles on head-to-head asks", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      templateId: "head_to_head_ab",
      question: {
        ...VALID_REQUEST.question,
        templateId: "head_to_head_ab",
        title: "Vote up if Codex is your default over Claude",
        templateInputs: {
          optionAKey: "A",
          optionALabel: "Codex",
          optionBKey: "B",
          optionBLabel: "Claude",
        },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "question.title",
        }),
      ]),
    );
  });

  it("rejects head-to-head template on bundled asks", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      questions: [
        {
          ...VALID_REQUEST.question,
          templateId: "head_to_head_ab",
          title: "Do you prefer A = Codex or B = Claude?",
          templateInputs: {
            optionAKey: "A",
            optionALabel: "Codex",
            optionBKey: "B",
            optionBLabel: "Claude",
          },
        },
        {
          ...VALID_REQUEST.question,
          title: "Second question",
        },
      ],
      question: undefined,
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "questions.0.templateId",
        }),
      ]),
    );
  });

  it("rejects bundled head-to-head asks even when other warnings are present", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      questions: [
        {
          ...VALID_REQUEST.question,
          description: "Choose one option from the comparison.",
          templateId: "head_to_head_ab",
          title: "Do you prefer A = Codex or B = Claude?",
          templateInputs: {
            optionAKey: "A",
            optionALabel: "Codex",
            optionBKey: "B",
            optionBLabel: "Claude",
          },
        },
        {
          ...VALID_REQUEST.question,
          title: "Should this agent proceed with the fallback plan?",
        },
      ],
      question: undefined,
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          path: "questions.0.description",
        }),
        expect.objectContaining({
          level: "error",
          message: expect.stringContaining("head_to_head_ab"),
          path: "questions.0.templateId",
        }),
      ]),
    );
  });
});
