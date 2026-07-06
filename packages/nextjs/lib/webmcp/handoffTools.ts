import type { WebMcpToolDefinition } from "./registerTools";

export type HandoffWebMcpQuestion = {
  categoryId: string;
  hasPublicContext: boolean;
  tags: string[];
  title: string;
};

export type HandoffWebMcpState = {
  bountyLabel: string;
  canPrepare: boolean;
  canSaveDraft: boolean;
  canSubmit: boolean;
  chainId: number | null;
  connectedChainId: number | null;
  connectedMismatch: boolean;
  connectedWallet: string | null;
  draftError: string | null;
  error: string | null;
  feedbackBonusLabel: string;
  feedbackBonusNeedsConfirmation: boolean;
  feedbackBonusStatus: string | null;
  handoffId: string;
  hasConnectedWallet: boolean;
  hasTransactionPlan: boolean;
  hasUnsavedDraft: boolean;
  isLoaded: boolean;
  isTerminalStatus: boolean;
  needsChainSwitch: boolean;
  questions: HandoffWebMcpQuestion[];
  status: string;
  walletAddress: string | null;
};

export function validateHandoffWebMcpDraft(state: HandoffWebMcpState) {
  const issues: string[] = [];

  if (!state.isLoaded) {
    issues.push("Handoff is not loaded.");
  }
  if (state.error) {
    issues.push(state.error);
  }
  if (state.draftError) {
    issues.push(state.draftError);
  }
  if (state.connectedMismatch) {
    issues.push("Connected wallet does not match the handoff wallet.");
  }
  if (state.needsChainSwitch) {
    issues.push(`Wallet must switch to chain ${state.chainId}.`);
  }
  if (state.hasUnsavedDraft) {
    issues.push("Draft changes must be saved before submission.");
  }
  if (state.bountyLabel === "Unknown bounty") {
    issues.push("Bounty amount is missing.");
  }
  if (state.questions.length === 0) {
    issues.push("At least one question is required.");
  }

  state.questions.forEach((question, index) => {
    const label = state.questions.length > 1 ? `Question ${index + 1}` : "Question";
    if (!question.title.trim()) {
      issues.push(`${label} needs a title.`);
    }
    if (!question.categoryId.trim()) {
      issues.push(`${label} needs a category.`);
    }
    if (question.tags.length === 0 || question.tags.length > 3) {
      issues.push(`${label} needs one to three tags.`);
    }
    if (!question.hasPublicContext) {
      issues.push(`${label} needs public context.`);
    }
  });

  return {
    issues,
    valid: issues.length === 0,
  };
}

export function getHandoffWebMcpNextAction(state: HandoffWebMcpState) {
  if (!state.isLoaded) return "Open a valid handoff link and wait for the handoff to load.";
  if (state.status === "expired") return "Create a fresh handoff link.";
  if (state.feedbackBonusNeedsConfirmation) {
    return "Retry Feedback Bonus confirmation with the stored bonus transaction hashes.";
  }
  if (state.status === "submitted") return "Read the public result or poll the ask status.";
  if (state.error) return "Resolve the handoff error shown in the browser.";
  if (state.draftError) return "Fix the draft error shown in the browser.";
  if (!state.hasConnectedWallet) return "Connect the wallet that will fund this ask.";
  if (state.connectedMismatch) return "Connect the wallet expected by this handoff.";
  if (state.needsChainSwitch) return `Switch the wallet to chain ${state.chainId}.`;
  if (state.hasUnsavedDraft) return "Save the draft before submitting.";
  if (state.hasTransactionPlan) return "Approve the prepared wallet calls in the browser.";
  if (state.canPrepare) return "Prepare the ask in the browser, then approve the wallet calls.";
  if (state.isTerminalStatus) return "No browser action is available for this terminal handoff.";
  return "Review the ask details in the browser.";
}

function summarizeHandoffWebMcpStatus(state: HandoffWebMcpState) {
  return {
    bountyLabel: state.bountyLabel,
    canSaveDraft: state.canSaveDraft,
    canSubmit: state.canSubmit,
    chainId: state.chainId,
    connectedChainId: state.connectedChainId,
    connectedWallet: state.connectedWallet,
    feedbackBonusLabel: state.feedbackBonusLabel,
    feedbackBonusNeedsConfirmation: state.feedbackBonusNeedsConfirmation,
    feedbackBonusStatus: state.feedbackBonusStatus,
    handoffId: state.handoffId,
    nextAction: getHandoffWebMcpNextAction(state),
    questionCount: state.questions.length,
    status: state.status,
    walletAddress: state.walletAddress,
  };
}

const EMPTY_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {},
  type: "object",
};

export function createHandoffWebMcpTools(readState: () => HandoffWebMcpState): WebMcpToolDefinition[] {
  return [
    {
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      description:
        "Read the current RateLoop browser handoff state. This does not sign, fund, submit, or change the draft.",
      execute: () => summarizeHandoffWebMcpStatus(readState()),
      inputSchema: EMPTY_INPUT_SCHEMA,
      name: "rateloop_get_browser_handoff_status",
      title: "Get RateLoop Handoff Status",
    },
    {
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      description:
        "Validate the current RateLoop handoff draft and report missing browser-visible fields. This does not save or submit.",
      execute: () => validateHandoffWebMcpDraft(readState()),
      inputSchema: EMPTY_INPUT_SCHEMA,
      name: "rateloop_validate_handoff_draft",
      title: "Validate RateLoop Handoff Draft",
    },
    {
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      description:
        "Summarize the next browser action for this RateLoop handoff. Wallet-sensitive actions still require visible user approval.",
      execute: () => ({
        nextAction: getHandoffWebMcpNextAction(readState()),
        requiresUserApproval: true,
      }),
      inputSchema: EMPTY_INPUT_SCHEMA,
      name: "rateloop_summarize_handoff_next_action",
      title: "Summarize RateLoop Handoff Next Action",
    },
  ];
}
