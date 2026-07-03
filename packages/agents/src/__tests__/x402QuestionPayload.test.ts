import { afterEach, describe, expect, it } from "vitest";
import { parseX402QuestionRequest } from "../x402QuestionPayload.js";

const originalAppUrl = process.env.APP_URL;
const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercelUrl = process.env.VERCEL_URL;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
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
  clientRequestId: "agents:test",
  question: {
    categoryId: "5",
    contextUrl: "https://example.com/mockup",
    description: "Vote based on the source material and the prompt.",
    imageUrls: [],
    tags: ["Media"],
    title: "Is this mockup ready?",
  },
  roundConfig: {
    maxVoters: "50",
    minVoters: "3",
    questionDurationSeconds: "1200",
  },
};

describe("x402 question bounty eligibility", () => {
  it("defaults large bounties to open eligibility", () => {
    const payload = parseX402QuestionRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        amount: "500000000",
      },
    });

    expect(payload.bounty.bountyEligibility).toBe(0);
  });

  it("accepts explicit open eligibility for large bounties", () => {
    const payload = parseX402QuestionRequest({
      ...VALID_REQUEST,
      bounty: {
        ...VALID_REQUEST.bounty,
        amount: "500000000",
        bountyEligibility: "0",
      },
    });

    expect(payload.bounty.bountyEligibility).toBe(0);
  });
});

describe("x402 question integer parsing", () => {
  it("rejects partial chain ids", () => {
    expect(() =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        chainId: "480abc",
      }),
    ).toThrow("chainId must be a positive integer.");
  });

  it("rejects partial template versions", () => {
    expect(() =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        templateVersion: "1abc",
      }),
    ).toThrow("templateVersion must be a positive integer.");
  });
});

describe("x402 question attachment origins", () => {
  it("rejects production uploaded images from hostile configured app origins", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://evil.example";
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(() =>
      parseX402QuestionRequest({
        ...VALID_REQUEST,
        question: {
          ...VALID_REQUEST.question,
          imageUrls: [
            `https://evil.example/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0x${"a".repeat(64)}`,
          ],
        },
      }),
    ).toThrow(/imageUrls must come from RateLoop uploads/);
  });

  it("allows production uploaded images from trusted RateLoop app subdomains", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://safe.rateloop.ai";
    delete process.env.NEXT_PUBLIC_APP_URL;

    const imageUrl = `https://safe.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0x${"a".repeat(64)}`;
    const payload = parseX402QuestionRequest({
      ...VALID_REQUEST,
      question: {
        ...VALID_REQUEST.question,
        imageUrls: [imageUrl],
      },
    });

    expect(payload.questions[0].imageUrls).toEqual([imageUrl]);
  });
});
