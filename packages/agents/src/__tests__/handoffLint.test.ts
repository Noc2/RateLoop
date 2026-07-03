import { describe, expect, it } from "vitest";
import {
  lintGeneratedImageHandoffShape,
  shouldKeepHandoffFinding,
} from "../handoffLint.js";
import type { QuestionLintFinding } from "../questions/types.js";

const missingContextFinding = (path: string): QuestionLintFinding => ({
  level: "error",
  message: "Context URL, RateLoop-hosted details URL, image URL, or video URL is required.",
  path,
});

describe("handoff lint filtering", () => {
  it("keeps generic lint findings without generated images", () => {
    expect(
      shouldKeepHandoffFinding(missingContextFinding("question.contextUrl"), {
        hasGeneratedImages: false,
        payload: { question: {} },
      }),
    ).toBe(true);
  });

  it("suppresses missing single-question context when generated images are staged", () => {
    expect(
      shouldKeepHandoffFinding(missingContextFinding("question.contextUrl"), {
        hasGeneratedImages: true,
        payload: { question: {} },
      }),
    ).toBe(false);
  });

  it("suppresses single-item questions array context when generated images are staged", () => {
    expect(
      shouldKeepHandoffFinding(missingContextFinding("questions.0.contextUrl"), {
        hasGeneratedImages: true,
        payload: { questions: [{}] },
      }),
    ).toBe(false);
  });

  it("keeps bundle context errors and other validation failures", () => {
    expect(
      shouldKeepHandoffFinding(missingContextFinding("questions.1.contextUrl"), {
        hasGeneratedImages: true,
        payload: { questions: [{}, {}] },
      }),
    ).toBe(true);
    expect(
      shouldKeepHandoffFinding(
        { level: "error", message: "Context URL must be a public HTTPS URL.", path: "questions.0.contextUrl" },
        { hasGeneratedImages: true, payload: { questions: [{}] } },
      ),
    ).toBe(true);
  });

  it("rejects generated-image handoffs with multiple questions before the network request", () => {
    expect(
      lintGeneratedImageHandoffShape({
        hasGeneratedImages: true,
        payload: { questions: [{ title: "A" }, { title: "B" }] },
      }),
    ).toEqual([
      {
        level: "error",
        message: "generatedImages currently support single-question handoffs.",
        path: "questions",
      },
    ]);
  });

  it("allows generated-image handoffs for a question object or one question array item", () => {
    expect(
      lintGeneratedImageHandoffShape({
        hasGeneratedImages: true,
        payload: { question: { title: "A" } },
      }),
    ).toEqual([]);
    expect(
      lintGeneratedImageHandoffShape({
        hasGeneratedImages: true,
        payload: { questions: [{ title: "A" }] },
      }),
    ).toEqual([]);
  });
});
