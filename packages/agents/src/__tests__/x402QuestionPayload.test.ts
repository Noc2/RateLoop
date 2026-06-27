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
    bountyStartBy: "1762000000",
    bountyWindowSeconds: "1200",
    feedbackWindowSeconds: "1200",
    requiredSettledRounds: "1",
    requiredVoters: "3",
  },
  chainId: 480,
  clientRequestId: "agents:test",
  question: {
    categoryId: "5",
    description: "Vote based on the source material and the prompt.",
    imageUrls: [],
    tags: ["Media"],
    title: "Is this mockup ready?",
  },
};

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
