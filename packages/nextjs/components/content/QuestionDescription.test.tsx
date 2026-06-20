import React from "react";
import { QuestionDescription, readQuestionDetailsResponseText } from "./QuestionDescription";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { MAX_QUESTION_DETAILS_TEXT_BYTES } from "~~/lib/attachments/questionDetails.shared";
import { resolveQuestionDetailsFetchUrl } from "~~/lib/attachments/questionDetailsUrls";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("QuestionDescription renders question references as internal rate links", () => {
  const html = renderToStaticMarkup(
    <QuestionDescription description="Compare this with [[question:42]] before rating." />,
  ).replace(/\s+/g, " ");

  assert.match(html, /Compare this with/);
  assert.match(html, /href="\/rate\?content=42"/);
  assert.match(html, /Question #42/);
  assert.match(html, /before rating\./);
});

test("QuestionDescription prefers custom labels and fetched question titles", () => {
  const referencedContentById = new Map([
    ["42", { id: 42n, question: "Is the alternative clearer?" }],
    ["43", { id: 43n, title: "Fallback title" }],
  ]);
  const html = renderToStaticMarkup(
    <QuestionDescription
      description="Try [[question:42]] and [[question:43|the fallback option]]."
      referencedContentById={referencedContentById}
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, /Is the alternative clearer\?/);
  assert.match(html, /the fallback option/);
  assert.doesNotMatch(html, /Fallback title/);
});

test("QuestionDescription can render a shorter preview before expansion", () => {
  const html = renderToStaticMarkup(
    <QuestionDescription
      description="One two three four five six seven eight nine ten eleven twelve"
      previewWordLimit={5}
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, /One two three four five\.\.\./);
  assert.doesNotMatch(html, /six seven/);
  assert.match(html, /Show More/);
});

test("QuestionDescription can keep the preview toggle adjacent to clamped mobile text", () => {
  const html = renderToStaticMarkup(
    <QuestionDescription
      description="One two three four five six seven eight nine ten eleven twelve"
      previewLayout="inline-toggle"
      previewWordLimit={5}
      className="text-base leading-relaxed"
    />,
  ).replace(/\s+/g, " ");

  assert.match(html, /flex min-w-0 items-baseline gap-2/);
  assert.match(html, /line-clamp-1/);
  assert.match(html, /whitespace-nowrap/);
  assert.match(html, /One two three four five\.\.\./);
  assert.match(html, /Show More/);
});

test("readQuestionDetailsResponseText rejects oversized details by content length", async () => {
  const response = new Response("small", {
    headers: {
      "content-length": String(MAX_QUESTION_DETAILS_TEXT_BYTES + 1),
    },
  });

  await assert.rejects(readQuestionDetailsResponseText(response), /Details are too large/);
});

test("readQuestionDetailsResponseText rejects streamed details above the byte cap", async () => {
  const response = new Response("a".repeat(MAX_QUESTION_DETAILS_TEXT_BYTES + 1));

  await assert.rejects(readQuestionDetailsResponseText(response), /Details are too large/);
});

test("resolveQuestionDetailsFetchUrl rewrites RateLoop details URLs to same-origin paths", () => {
  assert.equal(
    resolveQuestionDetailsFetchUrl(
      "https://rateloop.ai/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh",
      "https://www.rateloop.ai",
    ),
    "/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh",
  );
  assert.equal(
    resolveQuestionDetailsFetchUrl(
      "https://www.rateloop.ai/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh",
      "https://rateloop.ai",
    ),
    "/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh",
  );
});

test("resolveQuestionDetailsFetchUrl preserves gated address query when rewriting", () => {
  assert.equal(
    resolveQuestionDetailsFetchUrl(
      "https://rateloop.ai/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh?address=0x1234567890abcdef1234567890abcdef12345678",
      "https://www.rateloop.ai",
    ),
    "/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh?address=0x1234567890abcdef1234567890abcdef12345678",
  );
});

test("resolveQuestionDetailsFetchUrl leaves external and preview details URLs unchanged", () => {
  assert.equal(
    resolveQuestionDetailsFetchUrl(
      "https://rateloop.ai/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh",
      "https://rate-loop-nextjs-git-main-noc2-6281s-projects.vercel.app",
    ),
    "https://rateloop.ai/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh",
  );
  assert.equal(
    resolveQuestionDetailsFetchUrl(
      "https://evil.example/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh",
      "https://www.rateloop.ai",
    ),
    "https://evil.example/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh",
  );
});
