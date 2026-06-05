import React from "react";
import { QuestionDescription, readQuestionDetailsResponseText } from "./QuestionDescription";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { MAX_QUESTION_DETAILS_TEXT_BYTES } from "~~/lib/attachments/questionDetails.shared";

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
