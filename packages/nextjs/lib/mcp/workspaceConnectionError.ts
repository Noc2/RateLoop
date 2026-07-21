export const WORKSPACE_CONFLICT_RECOVERY_ACTION =
  "This connection message cannot move an existing Codex connection. Create a reconnect message for the intended agent in RateLoop, then retry from the same task.";

export const WORKSPACE_MOVE_CONSEQUENCE =
  "Moving this Codex connection will disconnect it from its current RateLoop workspace and replace the selected agent’s previous connection.";

export const WORKSPACE_MOVE_CONFIRMATION_ACTION =
  "After the user explicitly accepts that consequence, call rateloop_confirm_workspace_move. If that tool is unavailable, privately append the returned confirm_move fragment parameter to the preserved original connection URL and call rateloop_connect_workspace again. The workspace owner must then approve the move on RateLoop before the agent retries the unmodified privately preserved URL.";

type WorkspaceToolError = {
  code: string;
  message: string;
  retryable: boolean;
};

/** Add only server-authored, display-safe recovery guidance to workspace MCP errors. */
export function workspaceToolErrorPayload(error: WorkspaceToolError) {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.code === "workspace_conflict" ? { recoveryAction: WORKSPACE_CONFLICT_RECOVERY_ACTION } : {}),
  };
}
