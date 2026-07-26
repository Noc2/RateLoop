import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const FORM_FILES = [
  "../account/AccountDeletionPanel.tsx",
  "../account/InvitationRedemption.tsx",
  "../account/InvitationRouterPanel.tsx",
  "../account/NotificationSettingsPanel.tsx",
  "../account/PasskeyManagementPanel.tsx",
  "../account/ProfileClient.tsx",
  "../agents/WorkspaceReviewersPanel.tsx",
  "../agents/setup/WorkspaceSetupStart.tsx",
] as const;

const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "file", "hidden", "radio", "range"]);

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function rawTextInputs(value: string) {
  return [...value.matchAll(/<input\b[\s\S]*?\/>/gu)]
    .map(match => match[0])
    .filter(input => {
      const type = /\btype="([^"]+)"/u.exec(input)?.[1] ?? "text";
      return !NON_TEXT_INPUT_TYPES.has(type);
    });
}

test("retrofitted account and workspace forms keep editable text in the shared field primitive", () => {
  for (const file of FORM_FILES) {
    const value = source(file);
    assert.match(value, /from "~~\/components\/tokenless\/forms\/Field"/u, `${file} imports Field`);
    assert.match(value, /useFormErrors\(\)/u, `${file} preserves server field errors`);
    assert.deepEqual(rawTextInputs(value), [], `${file} has a raw editable text input`);
  }
});

test("retrofitted handlers return the exact field that clients render", () => {
  const mappings = [
    ["../../../app/api/account/deletion/route.ts", "confirmation"],
    ["../../../app/api/account/reviewer-invitations/preview/route.ts", "token"],
    ["../../../app/api/account/reviewer-invitations/redeem/route.ts", "token"],
    ["../../../app/api/account/workspace-invitations/redeem/route.ts", "token"],
    ["../../../app/api/account/workspaces/route.ts", "name"],
    ["../../../app/api/notifications/email/route.ts", "email"],
    ["../../../lib/tokenless/accountProfile.ts", "displayName"],
  ] as const;

  for (const [file, field] of mappings) {
    assert.match(source(file), new RegExp(`["']${field}["']`, "u"), `${file} maps ${field}`);
  }
});
