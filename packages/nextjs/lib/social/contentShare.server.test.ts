import { getContentShareDataForParam } from "./contentShare.server";
import assert from "node:assert/strict";
import test from "node:test";

test("getContentShareDataForParam preserves Ponder base path prefixes", async () => {
  const originalPonderUrl = process.env.NEXT_PUBLIC_PONDER_URL;
  process.env.NEXT_PUBLIC_PONDER_URL = "https://ponder.example/api";

  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    requestedUrls.push(input.toString());

    return new Response(
      JSON.stringify({
        content: {
          id: "88",
          title: "A disputed piece of content",
          description: "A compact summary for social previews.",
          rating: 50,
          ratingBps: 5_000,
          totalVotes: 1,
          lastActivityAt: "1776160800",
          openRound: null,
        },
      }),
    );
  };

  try {
    const shareData = await getContentShareDataForParam("88", {
      fetchImpl,
      origin: "https://www.rateloop.ai",
    });

    assert.equal(requestedUrls[0], "https://ponder.example/api/content/88");
    assert.equal(shareData?.contentId, "88");
  } finally {
    if (originalPonderUrl === undefined) {
      delete process.env.NEXT_PUBLIC_PONDER_URL;
    } else {
      process.env.NEXT_PUBLIC_PONDER_URL = originalPonderUrl;
    }
  }
});

test("getContentShareDataForParam redacts gated private-context content", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalFrontendCode = process.env.NEXT_PUBLIC_FRONTEND_CODE;
  const originalPonderUrl = process.env.NEXT_PUBLIC_PONDER_URL;
  process.env.DATABASE_URL = "memory:";
  process.env.NEXT_PUBLIC_FRONTEND_CODE = "0x3333333333333333333333333333333333333333";
  process.env.NEXT_PUBLIC_PONDER_URL = "https://ponder.example";

  const dbModule = await import("~~/lib/db");
  const dbTestMemory = await import("~~/lib/db/testing/testMemory");
  const confidentiality = await import("~~/lib/confidentiality/context");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());

  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        content: {
          id: "99",
          title: "Secret launch concept",
          description: "Confidential concept details.",
          url: "https://example.com/private",
          imageUrl: "https://example.com/private.png",
          rating: 50,
          ratingBps: 5_000,
          totalVotes: 1,
          lastActivityAt: "1776160800",
          openRound: null,
        },
      }),
    );

  try {
    await confidentiality.upsertQuestionConfidentialityFromMetadata({
      contentId: "99",
      metadata: {
        confidentiality: {
          disclosurePolicy: "after_settlement",
          visibility: "gated",
        },
      },
    });

    const shareData = await getContentShareDataForParam("99", {
      fetchImpl,
      origin: "https://www.rateloop.ai",
    });

    assert.equal(shareData?.contentTitle, "Private RateLoop question");
    assert.equal(shareData?.contentDescription, "This question uses private RateLoop-hosted context.");
    assert.equal(shareData?.contentImageUrl, null);
    assert.ok(!shareData?.title.includes("Secret launch concept"));
    assert.ok(!shareData?.description.includes("Confidential concept details"));
  } finally {
    dbModule.__setDatabaseResourcesForTests(null);
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalFrontendCode === undefined) {
      delete process.env.NEXT_PUBLIC_FRONTEND_CODE;
    } else {
      process.env.NEXT_PUBLIC_FRONTEND_CODE = originalFrontendCode;
    }
    if (originalPonderUrl === undefined) {
      delete process.env.NEXT_PUBLIC_PONDER_URL;
    } else {
      process.env.NEXT_PUBLIC_PONDER_URL = originalPonderUrl;
    }
  }
});

test("getContentShareDataForParam fails closed when Ponder marks content gated", async () => {
  const originalPonderUrl = process.env.NEXT_PUBLIC_PONDER_URL;
  process.env.NEXT_PUBLIC_PONDER_URL = "https://ponder.example";

  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        content: {
          id: "100",
          title: "Sensitive prompt",
          description: "Private research details.",
          url: "https://example.com/private",
          imageUrl: "https://example.com/private.png",
          contextAccess: "gated",
          rating: 50,
          ratingBps: 5_000,
          totalVotes: 1,
          lastActivityAt: "1776160800",
          openRound: null,
        },
      }),
    );

  try {
    const shareData = await getContentShareDataForParam("100", {
      fetchImpl,
      origin: "https://www.rateloop.ai",
    });

    assert.equal(shareData?.contentTitle, "Private RateLoop question");
    assert.equal(shareData?.contentDescription, "This question uses private RateLoop-hosted context.");
    assert.equal(shareData?.contentImageUrl, null);
    assert.ok(!shareData?.title.includes("Sensitive prompt"));
    assert.ok(!shareData?.description.includes("Private research details"));
  } finally {
    if (originalPonderUrl === undefined) {
      delete process.env.NEXT_PUBLIC_PONDER_URL;
    } else {
      process.env.NEXT_PUBLIC_PONDER_URL = originalPonderUrl;
    }
  }
});
