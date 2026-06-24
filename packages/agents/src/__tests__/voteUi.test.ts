import { describe, expect, it } from "vitest";
import { buildQuestionSpecHashes } from "../questionSpecs.js";
import {
  HEAD_TO_HEAD_AB_TEMPLATE_ID,
  inferHeadToHeadAbQuestionFromText,
  inferHeadToHeadVoteUiFromText,
  isHeadToHeadAbResultSpecHash,
  normalizeInferredHeadToHeadAbRequestBody,
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
      title: "Do you prefer A = Codex or B = Claude?",
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

  it("infers head-to-head vote ui from title when metadata is missing", () => {
    const template = findAgentResultTemplate(HEAD_TO_HEAD_AB_TEMPLATE_ID);
    expect(template).toBeTruthy();

    expect(
      resolveVoteUiConfig({
        resultSpecHash: template!.resultSpecHash,
        text: "Do you prefer A = Awesome or B = Bad?",
      }),
    ).toEqual({
      mode: "head_to_head",
      optionAKey: "A",
      optionALabel: "Awesome",
      optionBKey: "B",
      optionBLabel: "Bad",
    });
  });

  it("infers head-to-head vote ui from title even without head-to-head result spec hash", () => {
    const generic = findAgentResultTemplate("generic_rating");
    expect(
      resolveVoteUiConfig({
        resultSpecHash: generic?.resultSpecHash,
        text: "Do you prefer A = Awesome or B = Bad?",
      }),
    ).toMatchObject({
      mode: "head_to_head",
      optionALabel: "Awesome",
      optionBLabel: "Bad",
    });
  });

  it("maps inferred A/B labels to vote ui config", () => {
    expect(inferHeadToHeadVoteUiFromText("Do you prefer A = Awesome or B = Bad?")).toEqual({
      mode: "head_to_head",
      optionAKey: "A",
      optionALabel: "Awesome",
      optionBKey: "B",
      optionBLabel: "Bad",
    });
  });

  it("detects head-to-head result spec hashes", () => {
    const template = findAgentResultTemplate(HEAD_TO_HEAD_AB_TEMPLATE_ID);
    expect(isHeadToHeadAbResultSpecHash(template?.resultSpecHash)).toBe(true);
    expect(isHeadToHeadAbResultSpecHash(findAgentResultTemplate("generic_rating")?.resultSpecHash)).toBe(false);
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

  it("infers explicit Option A/B comparison labels from vote-up wording", () => {
    expect(
      inferHeadToHeadAbQuestionFromText(
        "Vote up for Option A: Hermes Agent over Option B: OpenClaw for RateLoop agent loops.",
      ),
    ).toEqual({
      optionALabel: "Hermes Agent",
      optionBLabel: "OpenClaw",
      title: "Do you prefer A = Hermes Agent or B = OpenClaw?",
    });
  });

  it("normalizes single-question handoff payloads with explicit Option A/B wording", () => {
    const normalized = normalizeInferredHeadToHeadAbRequestBody({
      bounty: {
        amount: "1000000",
        bountyStartBy: "1893456000",
        bountyWindowSeconds: "1200",
      },
      clientRequestId: "hermes-vs-openclaw",
      question: {
        categoryId: "6",
        tags: ["ai-agents"],
        templateId: "generic_rating",
        title: "Vote up for Option A: Hermes Agent over Option B: OpenClaw for RateLoop agent loops.",
      },
    });

    expect(normalized.inferred).toMatchObject({
      optionALabel: "Hermes Agent",
      optionBLabel: "OpenClaw",
    });
    expect(normalized.requestBody).toMatchObject({
      templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
      question: {
        templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
        templateInputs: {
          optionAKey: "A",
          optionALabel: "Hermes Agent",
          optionBKey: "B",
          optionBLabel: "OpenClaw",
        },
        title: "Do you prefer A = Hermes Agent or B = OpenClaw?",
      },
    });
  });
});
