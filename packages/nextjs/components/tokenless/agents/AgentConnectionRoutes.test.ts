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
const publicApi = readFileSync(
  new URL("../../../app/api/agent/v1/connection-intents/[intentId]/route.ts", import.meta.url),
  "utf8",
);
const publicPage = readFileSync(new URL("../../../app/(public)/connect/[intentId]/page.tsx", import.meta.url), "utf8");
const publicClient = readFileSync(new URL("./PublicAgentConnectionStatus.tsx", import.meta.url), "utf8");

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

test("public intent handoff is versioned, non-consuming, and never echoes a fragment", () => {
  assert.match(publicApi, /getPublicAgentConnectionIntent/);
  assert.match(publicApi, /schemaVersion: "2026-07-15"/);
  assert.match(publicApi, /rateloop_claim_connection_intent/);
  assert.match(publicApi, /rateloop_get_agent_context/);
  assert.match(publicApi, /rateloop_verify_connection/);
  assert.match(publicApi, /"Referrer-Policy": "no-referrer"/);
  assert.doesNotMatch(publicApi, /request\.nextUrl\.hash|searchParams\.get\(["']claim/);
  assert.doesNotMatch(publicApi, /claimNonce|claim_nonce/);
});

test("public connection page exposes safe human and machine handoff state", () => {
  assert.match(publicPage, /data-rateloop-agent-connection="2026-07-15"/);
  assert.match(publicPage, /rateloop_claim_connection_intent/);
  assert.match(publicPage, /Connected with safe access/);
  assert.match(publicPage, /never need[\s\S]{0,30}paste the connection message a second time/i);
  assert.match(publicPage, /referrer: "no-referrer"/);
  assert.match(publicPage, /robots: \{ follow: false, index: false \}/);
});

test("claim fragment is inspected only in the browser and never stored or sent", () => {
  assert.match(publicClient, /window\.location\.hash/);
  assert.match(publicClient, /new URLSearchParams/);
  assert.doesNotMatch(publicPage, /location\.hash|searchParams/);
  assert.doesNotMatch(publicClient, /fetch\(|sendBeacon|localStorage|sessionStorage/);
  assert.doesNotMatch(publicClient, /setFragmentState\(claim/);
});
