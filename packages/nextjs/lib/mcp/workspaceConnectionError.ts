export const WORKSPACE_CONFLICT_RECOVERY_ACTION =
  "This connection message cannot move an existing Codex connection. Create a reconnect message for the intended agent in RateLoop, then retry from the same task.";

export const WORKSPACE_MOVE_CONSEQUENCE =
  "Moving this Codex connection will disconnect it from its current RateLoop workspace and replace the selected agent’s previous connection.";

export const WORKSPACE_MOVE_CONFIRMATION_ACTION =
  "Confirm the move only after the user explicitly accepts that consequence. The workspace owner must then approve it on RateLoop before the agent retries the same privately preserved connection URL.";

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
