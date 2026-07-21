export const WORKSPACE_CONFLICT_RECOVERY_ACTION =
  "This Codex connection is active in another workspace. Complete the host’s OAuth action to connect this task with a separate credential.";

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
