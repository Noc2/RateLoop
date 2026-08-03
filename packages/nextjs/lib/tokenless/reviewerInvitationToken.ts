export const WORKSPACE_REVIEWER_INVITATION_PATTERN = /^rlri_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/u;

export function isWorkspaceReviewerInvitationToken(value: string) {
  return WORKSPACE_REVIEWER_INVITATION_PATTERN.test(value);
}

export function workspaceReviewerInvitationFromHash(hash: string) {
  const token = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get("invite")?.trim() ?? "";
  return isWorkspaceReviewerInvitationToken(token) ? token : null;
}
