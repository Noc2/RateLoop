import { describe, expect, it } from "vitest";
import { buildQuestionSpecHashes } from "../questionSpecs.js";
import {
  HEAD_TO_HEAD_AB_TEMPLATE_ID,
  readHeadToHeadTemplateInputs,
  readHeadToHeadVoteUiFromQuestionMetadata,
  resolveVoteUiConfig,
} from "../voteUi.js";
import { findAgentResultTemplate } from "../templates.js";

describe("voteUi", () => {
  it("reads head-to-head template inputs", () => {
    expect(
      readHeadToHeadTemplateInputs({
        optionAKey: "A",
        optionALabel: "Codex",
        optionBKey: "B",
        optionBLabel: "Claude",
      }),
    ).toEqual({
      mode: "head_to_head",
      optionAKey: "A",
      optionALabel: "Codex",
      optionBKey: "B",
      optionBLabel: "Claude",
    });
  });

  it("resolves head-to-head vote ui from result spec hash", () => {
    const template = findAgentResultTemplate(HEAD_TO_HEAD_AB_TEMPLATE_ID);
    expect(template).toBeTruthy();

    const spec = buildQuestionSpecHashes({
      categoryId: "6",
      contextUrl: "https://example.com",
      imageUrls: [],
      tags: ["comparison"],
      templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
      templateInputs: {
        optionAKey: "A",
        optionALabel: "Codex",
        optionBKey: "B",
        optionBLabel: "Claude",
      },
      title: "A vs B — which agent do you prefer?",
      videoUrl: "",
    });

    const metadata = spec.questionMetadata;
    expect(typeof metadata).toBe("object");
    expect(readHeadToHeadVoteUiFromQuestionMetadata(metadata)?.optionALabel).toBe("Codex");
    expect(
      resolveVoteUiConfig({
        resultSpecHash: template!.resultSpecHash,
        questionMetadata: metadata,
      }),
    ).toMatchObject({
      mode: "head_to_head",
      optionAKey: "A",
      optionBKey: "B",
    });
  });

  it("falls back to thumbs for generic rating", () => {
    const generic = findAgentResultTemplate("generic_rating");
    expect(
      resolveVoteUiConfig({
        resultSpecHash: generic?.resultSpecHash,
      }),
    ).toEqual({ mode: "thumbs" });
  });

  it("rejects option labels longer than 32 characters", () => {
    expect(
      readHeadToHeadTemplateInputs({
        optionAKey: "A",
        optionALabel: "A".repeat(33),
        optionBKey: "B",
        optionBLabel: "Claude",
      }),
    ).toBeNull();
  });
});
