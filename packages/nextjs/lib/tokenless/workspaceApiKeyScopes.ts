export const WORKSPACE_API_KEY_SCOPE_DETAILS = {
  "quote:read": {
    label: "Request review quotes",
    description: "Check panel availability and pricing before starting public review work.",
  },
  "panel:publish": {
    label: "Start review work",
    description: "Publish review panels and assignments for this workspace.",
  },
  "payment:submit": {
    label: "Spend workspace funds",
    description: "Reserve or submit payment when starting paid review work.",
  },
  "result:read": {
    label: "Read review results",
    description: "Retrieve completed review decisions and their supporting details.",
  },
  "evaluation:read": {
    label: "Read evaluation state",
    description: "Inspect automated evaluation receipts, outcomes, and linked human-review results.",
  },
  "review:decide": {
    label: "Check whether review is required",
    description: "Ask RateLoop whether a piece of work must be held for human review.",
  },
  "telemetry:write": {
    label: "Send evaluation telemetry",
    description: "Upload agent traces and automated evaluation receipts.",
  },
} as const;

export type WorkspaceApiKeyScope = keyof typeof WORKSPACE_API_KEY_SCOPE_DETAILS;

export const WORKSPACE_API_KEY_SCOPES = Object.keys(WORKSPACE_API_KEY_SCOPE_DETAILS) as WorkspaceApiKeyScope[];
