import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const promptSource = readFileSync(new URL("./AgentsSignInPrompt.tsx", import.meta.url), "utf8");
const sharedSurfaceSource = readFileSync(new URL("../../auth/SignInSurface.tsx", import.meta.url), "utf8");
const englishMessages = readFileSync(new URL("../../../messages/en/agents.json", import.meta.url), "utf8");
const germanMessages = readFileSync(new URL("../../../messages/de/agents.json", import.meta.url), "utf8");
const pageSource = readFileSync(
  new URL("../../../app/[locale]/(app)/agents/AgentsSectionPage.tsx", import.meta.url),
  "utf8",
);

test("anonymous visitors see the Agents sign-in prompt without exposing workspace controls", () => {
  assert.match(pageSource, /await findAuthSession\(cookieStore\.get\(AUTH_SESSION_COOKIE\)\?\.value\)/);
  assert.match(pageSource, /if \(!session\)/);
  assert.match(pageSource, /<AgentsSignInPrompt/);
  assert.match(pageSource, /returnTo=\{agentSignInReturnTo/);
  assert.ok(pageSource.indexOf("if (!session)") < pageSource.indexOf("<AgentWorkspacePanels"));
  assert.match(promptSource, /<SignedOutGate/);
  assert.match(promptSource, /returnTo=\{browserReturnTo\}/);
  assert.match(promptSource, /agentSignInReturnToWithHash\(returnTo, window\.location\.hash\)/);
  assert.match(promptSource, /title=\{t\("title"\)\}/);
  assert.doesNotMatch(promptSource, /For Agents/);
  // The card used to be titled "Agents" — character for character the sidebar
  // label already highlighted beside it — with the instruction demoted to a
  // description. It now carries one instruction title, the same shape the five
  // human gates use, and no description to repeat it.
  assert.doesNotMatch(promptSource, /description=/);
  assert.match(englishMessages, /Sign in to manage agents and reviews/);
  assert.match(germanMessages, /Anmelden, um Agenten und Prüfungen zu verwalten/);
  assert.doesNotMatch(englishMessages, /"title": "Agents"/);
  assert.doesNotMatch(promptSource, /AgentWorkspaceExample|Example workspace|preview=/);
  assert.match(promptSource, /href="\/docs\/ai"/);
  assert.match(promptSource, /\{t\("docs"\)\}/);
  assert.match(promptSource, /<Button/);
  assert.match(promptSource, /variant="secondary"/);
  // The secondary action used to hand-copy the sign-in control's geometry so the two
  // would line up. Both now ask for the same named size instead.
  assert.match(promptSource, /size="lg"/);
  assert.doesNotMatch(promptSource, /h-10|min-h-10|px-\[0\.9rem\]|btn-sm|min-h-11 w-full px-4/);
  assert.doesNotMatch(promptSource, /AgentWorkspacePanels|WorkspaceSettingsClient|Agent API keys|Create workspace/);
  assert.match(sharedSurfaceSource, /flex min-h-\[calc\(100vh-9rem\)\] grow items-center justify-center px-6 py-16/);
  assert.match(sharedSurfaceSource, /<Card as="section"/);
  assert.match(sharedSurfaceSource, /w-full max-w-md rounded-2xl p-8 text-center/);
});
