import { describe, expect, it } from "vitest";
import { HEAD_TO_HEAD_AB_TEMPLATE_ID } from "@rateloop/node-utils/voteUi";
import { attachVoteUiToContentResponse, extractVoteUiFromContentRecord } from "./voteUi.js";

describe("voteUi api helpers", () => {
  it("extracts head-to-head vote UI from question metadata", () => {
    const questionMetadata = {
      templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
      templateInputs: {
        optionAKey: "A",
        optionALabel: "Codex",
        optionBKey: "B",
        optionBLabel: "Claude",
      },
    };

    const record = {
      questionMetadata: JSON.stringify(questionMetadata),
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

  it("keeps voteUi after questionMetadata is redacted from the response", () => {
    const questionMetadata = {
      templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
      templateInputs: {
        optionAKey: "A",
        optionALabel: "Codex",
        optionBKey: "B",
        optionBLabel: "Claude",
      },
    };

    const withVoteUi = attachVoteUiToContentResponse({
      id: "1",
      questionMetadata: JSON.stringify(questionMetadata),
    }) as Record<string, unknown>;
    delete withVoteUi.questionMetadata;

    expect(withVoteUi.voteUi).toEqual({
      mode: "head_to_head",
      optionAKey: "A",
      optionALabel: "Codex",
      optionBKey: "B",
      optionBLabel: "Claude",
    });
  });

  it("infers voteUi from title when metadata preimage is missing", () => {
    const response = attachVoteUiToContentResponse({
      id: "5",
      title: "Do you prefer A = Awesome or B = Bad?",
    }) as Record<string, unknown>;

    expect(response.voteUi).toEqual({
      mode: "head_to_head",
      optionAKey: "A",
      optionALabel: "Awesome",
      optionBKey: "B",
      optionBLabel: "Bad",
    });
  });

  it("infers voteUi when question and title repeat the same text", () => {
    const title = "Do you prefer A = Awesome or B = Bad?";

    const response = attachVoteUiToContentResponse({
      id: "5",
      question: title,
      title,
    }) as Record<string, unknown>;

    expect(response.voteUi).toEqual({
      mode: "head_to_head",
      optionAKey: "A",
      optionALabel: "Awesome",
      optionBKey: "B",
      optionBLabel: "Bad",
    });
  });
});
