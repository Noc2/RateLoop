import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountCollection = readFileSync(
  new URL("../../../app/api/account/workspaces/[workspaceId]/agent-connections/route.ts", import.meta.url),
  "utf8",
);
const accountItem = readFileSync(
  new URL("../../../app/api/account/workspaces/[workspaceId]/agent-connections/[intentId]/route.ts", import.meta.url),
  "utf8",
);
const onboardingEvents = readFileSync(
  new URL(
    "../../../app/api/account/workspaces/[workspaceId]/agent-connections/onboarding-events/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const publicApi = readFileSync(
  new URL("../../../app/api/agent/v1/connection-intents/[intentId]/route.ts", import.meta.url),
  "utf8",
);
const publicPage = readFileSync(new URL("../../../app/(public)/connect/[intentId]/page.tsx", import.meta.url), "utf8");
const publicClient = readFileSync(new URL("./PublicAgentConnectionStatus.tsx", import.meta.url), "utf8");
const oauthRecovery = readFileSync(
  new URL(
    "../../../app/api/account/workspaces/[workspaceId]/agent-integrations/[integrationId]/recover-oauth/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("agent connection intent account routes require browser authentication and mutation protection", () => {
  assert.match(accountCollection, /requireBrowserSession\(request\)/);
  assert.match(accountCollection, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(accountCollection, /createAgentConnectionIntent/);
  assert.match(accountCollection, /listAgentConnectionIntents/);
  assert.match(accountCollection, /request\.nextUrl\.origin/);
  assert.match(accountItem, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(accountItem, /cancelAgentConnectionIntent/);
  assert.match(accountCollection, /"Cache-Control": "private, no-store"/);
  assert.match(accountItem, /"Cache-Control": "private, no-store"/);
});

test("OAuth recovery is an authenticated same-origin owner mutation", () => {
  assert.match(oauthRecovery, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(oauthRecovery, /recoverAgentIntegrationOAuth/);
  assert.match(oauthRecovery, /"Cache-Control": "private, no-store, max-age=0"/);
});

test("onboarding telemetry is authenticated and server-allowlisted", () => {
  assert.match(onboardingEvents, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(onboardingEvents, /parseConnectionMessageCopiedPayload\(body\)/);
  assert.match(onboardingEvents, /recordConnectionMessageCopied/);
  assert.doesNotMatch(onboardingEvents, /SimpleAnalytics|simpleanalytics|messageUrl|workspaceName|agentContent/u);
});

test("public intent handoff is versioned, non-consuming, and never echoes a fragment", () => {
  assert.match(publicApi, /getPublicAgentConnectionIntent/);
  assert.match(publicApi, /schemaVersion: "2026-07-17"/);
  assert.match(publicApi, /rateloop_connect_workspace/);
  assert.match(publicApi, /rateloop_claim_connection_intent/);
  assert.match(publicApi, /rateloop_get_agent_context/);
  assert.match(publicApi, /rateloop_verify_connection/);
  assert.match(publicApi, /"Referrer-Policy": "no-referrer"/);
  assert.doesNotMatch(publicApi, /request\.nextUrl\.hash|searchParams\.get\(["']claim/);
  assert.doesNotMatch(publicApi, /claimNonce|claim_nonce/);
});

test("public connection page exposes safe human and machine handoff state", () => {
  assert.match(publicPage, /data-rateloop-agent-connection="2026-07-17"/);
  assert.match(publicPage, /rateloop_connect_workspace/);
  assert.match(publicPage, /rateloop_claim_connection_intent/);
  assert.match(publicPage, /Agent connected/);
  assert.match(publicPage, /Complete by/);
  assert.doesNotMatch(publicPage, /For the workspace owner|For agents and hosts|generic connection guide/);
  assert.doesNotMatch(publicPage, /<span className="badge[\s\S]{0,100}\{intent\.status\}/);
  assert.match(publicPage, /referrer: "no-referrer"/);
  assert.match(publicPage, /robots: \{ follow: false, index: false \}/);
});

test("claim fragment is inspected only in the browser and never stored or sent", () => {
  assert.match(publicClient, /window\.location\.hash/);
  assert.match(publicClient, /new URLSearchParams/);
  assert.doesNotMatch(publicPage, /location\.hash|searchParams/);
  assert.doesNotMatch(publicClient, /fetch\(|sendBeacon|localStorage|sessionStorage/);
  assert.doesNotMatch(publicClient, /setFragmentState\(claim/);
  assert.match(publicClient, /Connection link found\. Return to your agent to continue\./);
  assert.doesNotMatch(publicClient, /activation claim is present|reconstruct or add a claim/);
});
