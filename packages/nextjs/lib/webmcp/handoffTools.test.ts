import {
  type HandoffWebMcpState,
  createHandoffWebMcpTools,
  getHandoffWebMcpNextAction,
  validateHandoffWebMcpDraft,
} from "./handoffTools";
import assert from "node:assert/strict";
import { test } from "node:test";

function baseState(overrides: Partial<HandoffWebMcpState> = {}): HandoffWebMcpState {
  return {
    bountyLabel: "2.5 USDC",
    canPrepare: true,
    canSaveDraft: false,
    canSubmit: true,
    chainId: 480,
    connectedChainId: 480,
    connectedMismatch: false,
    connectedWallet: "0x1111111111111111111111111111111111111111",
    draftError: null,
    error: null,
    feedbackBonusLabel: "Not included",
    handoffId: "ahf_test",
    hasConnectedWallet: true,
    hasTransactionPlan: false,
    hasUnsavedDraft: false,
    isLoaded: true,
    isTerminalStatus: false,
    needsChainSwitch: false,
    questions: [
      {
        categoryId: "5",
        hasPublicContext: true,
        tags: ["agent"],
        title: "Is this ready?",
      },
    ],
    status: "pending",
    walletAddress: "0x1111111111111111111111111111111111111111",
    ...overrides,
  };
}

test("validates missing handoff draft fields", () => {
  const result = validateHandoffWebMcpDraft(
    baseState({
      bountyLabel: "Unknown bounty",
      hasUnsavedDraft: true,
      questions: [
        {
          categoryId: "",
          hasPublicContext: false,
          tags: [],
          title: "",
        },
      ],
    }),
  );

  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("Draft changes must be saved before submission."));
  assert.ok(result.issues.includes("Bounty amount is missing."));
  assert.ok(result.issues.includes("Question needs a title."));
  assert.ok(result.issues.includes("Question needs a category."));
  assert.ok(result.issues.includes("Question needs one to three tags."));
  assert.ok(result.issues.includes("Question needs public context."));
});

test("summarizes the next handoff browser action", () => {
  assert.equal(
    getHandoffWebMcpNextAction(baseState({ hasConnectedWallet: false })),
    "Connect the wallet that will fund this ask.",
  );
  assert.equal(getHandoffWebMcpNextAction(baseState({ hasUnsavedDraft: true })), "Save the draft before submitting.");
  assert.equal(
    getHandoffWebMcpNextAction(baseState({ hasTransactionPlan: true })),
    "Approve the prepared wallet calls in the browser.",
  );
});

test("creates read-only handoff WebMCP tools", () => {
  const tools = createHandoffWebMcpTools(() => baseState());
  const statusTool = tools.find(tool => tool.name === "rateloop_handoff_get_status");
  const validateTool = tools.find(tool => tool.name === "rateloop_handoff_validate_draft");
  const actionTool = tools.find(tool => tool.name === "rateloop_handoff_summarize_next_action");

  assert.equal(tools.length, 3);
  assert.equal(statusTool?.annotations?.readOnlyHint, true);
  assert.equal(validateTool?.annotations?.readOnlyHint, true);
  assert.equal(actionTool?.annotations?.readOnlyHint, true);
  assert.deepEqual(statusTool?.execute({}), {
    bountyLabel: "2.5 USDC",
    canSaveDraft: false,
    canSubmit: true,
    chainId: 480,
    connectedChainId: 480,
    connectedWallet: "0x1111111111111111111111111111111111111111",
    feedbackBonusLabel: "Not included",
    handoffId: "ahf_test",
    nextAction: "Prepare the ask in the browser, then approve the wallet calls.",
    questionCount: 1,
    status: "pending",
    walletAddress: "0x1111111111111111111111111111111111111111",
  });
});
