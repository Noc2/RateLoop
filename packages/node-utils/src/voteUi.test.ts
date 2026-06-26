import assert from "node:assert/strict";
import test from "node:test";
import {
  HEAD_TO_HEAD_AB_TEMPLATE_ID,
  inferHeadToHeadVoteUiFromText,
  readHeadToHeadVoteUiFromQuestionMetadata,
  resolveVoteUiConfig,
} from "./voteUi";

const headToHeadMetadata = {
  templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
  templateInputs: {
    optionAKey: "A",
    optionALabel: "Codex",
    optionBKey: "B",
    optionBLabel: "Claude",
  },
};

test("readHeadToHeadVoteUiFromQuestionMetadata reads valid template metadata", () => {
  assert.deepEqual(readHeadToHeadVoteUiFromQuestionMetadata(headToHeadMetadata), {
    mode: "head_to_head",
    optionAKey: "A",
    optionALabel: "Codex",
    optionBKey: "B",
    optionBLabel: "Claude",
  });
});

test("inferHeadToHeadVoteUiFromText extracts compact A/B labels", () => {
  assert.deepEqual(
    inferHeadToHeadVoteUiFromText("Do you prefer A = Awesome or B = Bad?"),
    {
      mode: "head_to_head",
      optionAKey: "A",
      optionALabel: "Awesome",
      optionBKey: "B",
      optionBLabel: "Bad",
    },
  );
});

test("resolveVoteUiConfig falls back to thumbs when no head-to-head cue is present", () => {
  assert.deepEqual(
    resolveVoteUiConfig({
      questionMetadata: { templateId: "rating" },
      text: "Rate this landing page.",
    }),
    { mode: "thumbs" },
  );
});
