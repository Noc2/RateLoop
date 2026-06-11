import { describe, expect, it } from "vitest";
import { lintAgentAskRequest, summarizeLintFindings } from "../questions/lint.js";

const UPLOADED_IMAGE_URL =
  "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DETAILS_URL = "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop";
const DETAILS_HASH = `0x${"4".repeat(64)}`;

const VALID_REQUEST = {
  bounty: {
    amount: "1000000",
    requiredSettledRounds: "1",
    requiredVoters: "3",
  },
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
      expect.arrayContaining([expect.objectContaining({ level: "error", path: "question.contextUrl" })]),
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
  it("accepts an explicit roundConfig.minVoters that matches bounty.requiredVoters", () => {
    const findings = lintAgentAskRequest({
      ...VALID_REQUEST,
      bounty: { ...VALID_REQUEST.bounty, requiredVoters: "5" },
      roundConfig: {
        epochDuration: "1200",
        maxDuration: "1200",
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
        epochDuration: "1200",
        maxDuration: "1200",
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

  it("ignores omitted roundConfig and non-numeric voter values", () => {
    expect(
      summarizeLintFindings(
        lintAgentAskRequest({
          ...VALID_REQUEST,
          bounty: { ...VALID_REQUEST.bounty, requiredVoters: "5" },
        }),
      ).ok,
    ).toBe(true);

    expect(
      summarizeLintFindings(
        lintAgentAskRequest({
          ...VALID_REQUEST,
          roundConfig: { minVoters: "not-a-number" },
        }),
      ).ok,
    ).toBe(true);
  });
});
