import {
  getHeadToHeadQuestionTitleError,
  mergeHeadToHeadDraftQuestion,
  resolveAutoHeadToHeadTitle,
} from "./headToHeadQuestion";
import assert from "node:assert/strict";
import test from "node:test";

test("resolveAutoHeadToHeadTitle builds the canonical title", () => {
  assert.equal(resolveAutoHeadToHeadTitle("Codex", "Claude"), "Do you prefer A = Codex or B = Claude?");
});

test("mergeHeadToHeadDraftQuestion auto-fills the title from options", () => {
  const next = mergeHeadToHeadDraftQuestion(
    {
      templateId: "head_to_head_ab",
      title: "",
      optionALabel: "Codex",
      optionBLabel: "",
      headToHeadTitleMode: "auto",
    },
    { optionBLabel: "Claude" },
  );

  assert.equal(next.title, "Do you prefer A = Codex or B = Claude?");
  assert.equal(next.headToHeadTitleMode, "auto");
});

test("getHeadToHeadQuestionTitleError requires both option markers", () => {
  assert.equal(
    getHeadToHeadQuestionTitleError("Codex", "Claude", "Which agent is better?"),
    "Include both option names in the question, e.g. A = Codex and B = Claude.",
  );
  assert.equal(getHeadToHeadQuestionTitleError("Hermes", "OpenClaw", "Do you A = Hermes or B = OpenClaw?"), null);
});
