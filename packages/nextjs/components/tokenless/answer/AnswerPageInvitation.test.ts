import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../../../app/(app)/human/page.tsx", import.meta.url), "utf8");
const answer = readFileSync(new URL("./AnswerPageClient.tsx", import.meta.url), "utf8");

test("Discover opens invitation entry only from the boolean URL marker", () => {
  assert.match(page, /invitation === "1"/);
  assert.match(page, /initialInvitationOpen=\{invitation === "1"\}/);
  assert.match(answer, /aria-expanded=\{invitationOpen\}/);
  assert.match(answer, /aria-controls="discover-invitation-panel"/);
  assert.match(answer, /hidden=\{!invitationOpen\}/);
  assert.match(answer, /principalId \? \(/);
});

test("Discover refreshes both queues after acceptance and preserves invitation intent through sign-in", () => {
  assert.match(answer, /<InvitationRouterPanel onAccepted=\{\(\) => void load\(\)\} \/>/);
  assert.match(answer, /if \(invitationOpen\) params\.set\("invite", "1"\)/);
  assert.match(answer, /returnTo=\{discoverHref\(pathname, query, scope, initialInvitationOpen, view\)\}/);
});
