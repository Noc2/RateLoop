import { describe, expect, it } from "vitest";
import { buildQuestionSpecHashes } from "@rateloop/agents/question-specs";
import { HEAD_TO_HEAD_AB_TEMPLATE_ID } from "@rateloop/agents/voteUi";
import { attachVoteUiToContentResponse, extractVoteUiFromContentRecord } from "./voteUi.js";

describe("voteUi api helpers", () => {
  it("extracts head-to-head vote UI from question metadata", () => {
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

    const record = {
      questionMetadata: JSON.stringify(spec.questionMetadata),
    };

    expect(extractVoteUiFromContentRecord(record)).toEqual({
      mode: "head_to_head",
      optionAKey: "A",
      optionALabel: "Codex",
      optionBKey: "B",
      optionBLabel: "Claude",
    });

    const response = attachVoteUiToContentResponse({ id: "1", ...record }) as Record<string, unknown>;
    expect(response.voteUi).toEqual({
      mode: "head_to_head",
      optionAKey: "A",
      optionALabel: "Codex",
      optionBKey: "B",
      optionBLabel: "Claude",
    });
  });
});
