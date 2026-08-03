import { isWorkspaceReviewerInvitationToken, workspaceReviewerInvitationFromHash } from "./reviewerInvitationToken";
import assert from "node:assert/strict";
import test from "node:test";

const TOKEN = `rlri_0123456789abcdef_${"a".repeat(43)}`;

test("reviewer invitation parsing preserves only an exact bearer token from the fragment", () => {
  assert.equal(isWorkspaceReviewerInvitationToken(TOKEN), true);
  assert.equal(workspaceReviewerInvitationFromHash(`#invite=${TOKEN}`), TOKEN);
  assert.equal(workspaceReviewerInvitationFromHash(`#invite=${TOKEN.slice(0, -1)}`), null);
  assert.equal(workspaceReviewerInvitationFromHash("#invite=rlwi_workspace_secret"), null);
  assert.equal(workspaceReviewerInvitationFromHash("#section=invite"), null);
});
