import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceSettingsClient.tsx", import.meta.url), "utf8");
const apiKeyRoute = new URL("../../app/api/account/workspaces/[workspaceId]/api-keys/route.ts", import.meta.url);
const webhookRoute = new URL("../../app/api/account/workspaces/[workspaceId]/webhooks/route.ts", import.meta.url);

test("workspace settings keeps subscription and panel funding separate", () => {
  assert.match(source, /Workspace subscription/);
  assert.match(source, /Panel funding/);
  assert.match(source, /Settled USDC/);
  assert.match(source, /Reserved USDC/);
  assert.match(source, /Available USDC/);
  assert.match(source, /Separate from subscription billing/);
  assert.match(source, /\/billing\/\$\{kind\}/);
  assert.match(source, /kind: "checkout" \| "portal"/);
  assert.match(source, /plan: "early_access"/);
});

test("workspace settings communicates entitlement and checkout lifecycle", () => {
  assert.match(source, /role="progressbar"/);
  assert.match(source, /completed/);
  assert.match(source, /reserved/);
  assert.match(source, /Upgrade to Early Access/);
  assert.match(source, /Manage billing/);
  assert.match(source, /Billing is not enabled yet/);
  assert.match(source, /Your plan activates after payment confirmation/);
  assert.match(source, /Checkout was cancelled/);
  assert.match(source, /Existing accepted work can finish/);
  assert.match(source, /Workspace owners and billing members/);
});

test("workspace billing profile collects self-declared business invoice details", () => {
  assert.match(source, /\/billing\/profile/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /billing_profile_required/);
  assert.match(source, /Legal business name/);
  assert.match(source, /Registration number/);
  assert.match(source, /Registered address/);
  assert.match(source, /VAT country/);
  assert.match(source, /VAT ID/);
  assert.match(source, /Provide both VAT country and VAT ID/);
  assert.match(source, /not an external\s+identity or company verification/);
  assert.match(source, /Save billing details/);
});

test("workspace setup does not expose manual agent credentials or result webhooks", () => {
  assert.doesNotMatch(source, /Agent API keys|Result webhooks|\/api-keys|\/webhooks/);
  assert.match(source, /Connect an agent once/);
  assert.match(source, /RateLoop creates its bound access automatically/);
  assert.match(source, /\/agents\?tab=agents/);
  assert.equal(existsSync(apiKeyRoute), false);
  assert.equal(existsSync(webhookRoute), false);
});
