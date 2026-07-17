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
  assert.match(source, /About settled USDC/);
  assert.match(source, /Funds credited to this workspace after payment settlement/);
  assert.match(source, /About reserved USDC/);
  assert.match(source, /Funds committed to review work that has not reached its paid terminal state/);
  assert.match(source, /About available USDC/);
  assert.match(source, /Settled funds that are not reserved and can fund new review work/);
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
  assert.match(source, /Invoice funding address/);
  assert.match(source, /billingAddressLine1/);
  assert.match(source, /billingPostalCode/);
  assert.match(source, /required=\{hasInvoiceFundingAddress\}/);
});

test("workspace prepaid funding shows the balance, invoice link, and signed ledger", () => {
  assert.match(source, /Add prepaid balance by USD invoice/);
  assert.match(source, /Create invoice/);
  assert.match(source, /Top-up invoices/);
  assert.match(source, /Open invoice/);
  assert.match(source, /Balance ledger/);
  assert.match(source, /signedUsdc\(entry\.amountAtomic\)/);
  assert.match(source, /initialWorkspaceId/);
  assert.match(source, /htmlFor="workspace-prepaid-topup-amount"/);
  assert.match(source, /Workspace owners and billing members can add prepaid balance/);
  assert.match(source, /Loading prepaid funding/);
});

test("enterprise identity settings cover provider lifecycle and workspace-local SCIM", () => {
  assert.match(source, /Configure SSO and SCIM/);
  assert.match(source, /Add identity provider/);
  assert.match(source, /Get TXT token/);
  assert.match(source, /SSO-only/);
  assert.match(source, /Save provider/);
  assert.match(source, /Delete this identity provider/);
  assert.match(source, /SCIM Users endpoint/);
  assert.match(source, /SCIM Groups are not supported/);
  assert.match(source, /Last sync:/);
  assert.match(source, /Revoke this SCIM token/);
  assert.match(source, /identityFormDirty/);
  assert.match(source, /selected && canManageIdentity/);
  assert.match(source, /Enterprise identity is not enabled for this deployment/);
  assert.match(source, /Copy this SCIM bearer token now/);
  assert.match(source, /Publish this domain verification token/);
});

test("workspace setup does not expose manual agent credentials or result webhooks", () => {
  assert.doesNotMatch(source, /Agent API keys|Result webhooks|\/api-keys|\/webhooks/);
  assert.doesNotMatch(source, /Agent setup|Connect an agent once|RateLoop creates its bound access automatically/);
  assert.doesNotMatch(source, /Prepaid funds are usable only after settlement|Reserved amounts cannot be double-spent/);
  assert.equal(existsSync(apiKeyRoute), false);
  assert.equal(existsSync(webhookRoute), false);
});

test("workspace management creation continues into guided agent setup", () => {
  assert.match(source, /Create your workspace/);
  assert.match(source, /Name it, then connect your agent/);
  assert.match(source, /window\.location\.assign\(`\/agents\?workspace=.*&step=connect/);
  assert.match(source, /workspaces\.length === 0/);
  assert.match(source, /Create another workspace/);
  assert.doesNotMatch(source, /Create a workspace to fund panels/);
});
