import { buildQuestionSpecHashes } from "@rateloop/agents/question-specs";
import { findAgentResultTemplate } from "@rateloop/agents/templates";
import { HEAD_TO_HEAD_AB_TEMPLATE_ID } from "@rateloop/agents/voteUi";
import assert from "node:assert/strict";
import test from "node:test";
import {
  getCrowdForecastLabel,
  getSignalToneLabel,
  getVoteButtonPresentation,
  getVoteSubmittedToastMessage,
  resolveContentVoteUi,
} from "~~/lib/vote/voteUiConfig";

test("uses thumbs presentation by default", () => {
  assert.deepEqual(getVoteButtonPresentation({ mode: "thumbs" }, "up"), {
    variant: "thumbs",
    shortLabel: "Up",
    longLabel: "Thumbs up",
    ariaLabel: "Vote thumbs up",
    tooltip: "Thumbs up",
  });
});

test("uses letter presentation for head-to-head content", () => {
  const voteUi = {
    mode: "head_to_head" as const,
    optionAKey: "A",
    optionALabel: "Codex",
    optionBKey: "B",
    optionBLabel: "Claude",
  };

  assert.deepEqual(resolveContentVoteUi({ voteUi, resultSpecHash: null }), voteUi);
  assert.deepEqual(getVoteButtonPresentation(voteUi, "up"), {
    variant: "letters",
    shortLabel: "A",
    longLabel: "A: Codex",
    ariaLabel: "Vote for option A (Codex)",
    tooltip: "A: Codex",
  });
  assert.equal(getSignalToneLabel(voteUi, true), "A: Codex");
  assert.equal(getCrowdForecastLabel(voteUi), "% choosing A");
});

test("builds head-to-head result spec hash with template vote semantics", () => {
  const template = findAgentResultTemplate(HEAD_TO_HEAD_AB_TEMPLATE_ID);
  assert.ok(template);

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
    voteSemantics: template.voteSemantics,
  });

  assert.equal(spec.resultSpecHash, template.resultSpecHash);
  assert.equal(
    resolveContentVoteUi({
      resultSpecHash: spec.resultSpecHash,
      voteUi: null,
    }).mode,
    "thumbs",
  );
  assert.equal(
    resolveContentVoteUi({
      resultSpecHash: spec.resultSpecHash,
      voteUi: {
        mode: "head_to_head",
        optionAKey: "A",
        optionALabel: "Codex",
        optionBKey: "B",
        optionBLabel: "Claude",
      },
    }).mode,
    "head_to_head",
  );
});

test("formats head-to-head vote submitted toast copy", () => {
  assert.match(
    getVoteSubmittedToastMessage({
      config: {
        mode: "head_to_head",
        optionAKey: "A",
        optionALabel: "Codex",
        optionBKey: "B",
        optionBLabel: "Claude",
      },
      isUp: true,
      predictedUpPercent: 62,
      stakeStatus: "no reputation locked; network fee only.",
    }),
    /Vote submitted: A, crowd forecast 62% choosing A/,
  );
});
