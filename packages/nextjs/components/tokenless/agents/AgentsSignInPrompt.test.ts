import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const promptSource = readFileSync(new URL("./AgentsSignInPrompt.tsx", import.meta.url), "utf8");
const sharedSurfaceSource = readFileSync(new URL("../../auth/SignInSurface.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../../app/(app)/agents/page.tsx", import.meta.url), "utf8");

test("anonymous visitors see the Agents sign-in prompt without exposing workspace controls", () => {
  assert.match(pageSource, /await findAuthSession\(cookieStore\.get\(AUTH_SESSION_COOKIE\)\?\.value\)/);
  assert.match(pageSource, /if \(!session\) return <AgentsSignInPrompt \/>/);
  assert.ok(
    pageSource.indexOf("if (!session) return <AgentsSignInPrompt />") < pageSource.indexOf("<AgentWorkspacePanels"),
  );
  assert.match(promptSource, /<SignInSurface/);
  assert.match(promptSource, /title="Agents"/);
  assert.doesNotMatch(promptSource, /For Agents/);
  assert.match(promptSource, /Sign in to connect an agent/);
  assert.match(promptSource, /<AgentWorkspaceExample \/>/);
  assert.match(promptSource, /<ThirdwebSessionButton\s+compact/);
  assert.match(promptSource, /if \(authenticated\) router\.refresh\(\)/);
  assert.match(promptSource, /href="\/docs\/ai"/);
  assert.match(
    promptSource,
    /btn btn-outline h-10 min-h-10 w-auto min-w-0 px-\[0\.9rem\] text-base font-bold leading-none/,
  );
  assert.doesNotMatch(promptSource, /btn-sm|min-h-11 w-full px-4/);
  assert.doesNotMatch(promptSource, /AgentWorkspacePanels|WorkspaceSettingsClient|Agent API keys|Create workspace/);
  assert.match(sharedSurfaceSource, /flex min-h-\[calc\(100vh-9rem\)\] grow items-center justify-center px-6 py-16/);
  assert.match(sharedSurfaceSource, /<Card as="section"/);
  assert.match(sharedSurfaceSource, /w-full max-w-md rounded-2xl p-8 text-center/);
});
