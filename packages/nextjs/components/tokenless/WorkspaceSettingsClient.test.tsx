import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceSettingsClient.tsx", import.meta.url), "utf8");
const apiKeySource = readFileSync(new URL("./WorkspaceApiKeysPanel.tsx", import.meta.url), "utf8");
const apiKeyRoute = new URL("../../app/api/account/workspaces/[workspaceId]/api-keys/route.ts", import.meta.url);
const webhookRoute = new URL("../../app/api/account/workspaces/[workspaceId]/webhooks/route.ts", import.meta.url);

test("workspace members are managed before billing without reviewer controls", () => {
  const members = source.indexOf("<WorkspaceMembersPanel");
  const subscription = source.indexOf('id="workspace-plan"');
  assert.ok(members >= 0 && members < subscription);
  assert.match(source, /workspaceId=\{selected\.workspaceId\}/);
  assert.doesNotMatch(source, /active private|private groups/);
});

test("workspace settings keeps subscription and panel funding separate", () => {
  assert.match(source, /id="workspace-plan"/);
  assert.doesNotMatch(source, /Workspace subscription/);
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
  assert.match(source, /showPanelFunding/);
  assert.match(source, /const showPanelFunding = Boolean\(selected\)/);
  assert.match(source, /<WorkspacePublicContentLink[\s\S]*href="\/pricing"[\s\S]*Compare workspace plans/);
  assert.doesNotMatch(source, /How panel costs work/);
});

test("workspace settings focuses the funding hash after its async panel renders", () => {
  assert.match(source, /const panelFundingRef = useRef<HTMLElement>\(null\)/);
  assert.match(source, /window\.location\.hash !== "#panel-funding"/);
  assert.match(source, /panel\.scrollIntoView\?\.\(\{ block: "start" \}\)/);
  assert.match(source, /panel\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /window\.addEventListener\("hashchange", focusPanelFunding\)/);
  assert.match(source, /ref=\{panelFundingRef\}/);
  assert.match(source, /tabIndex=\{-1\}/);
});

test("workspace settings communicates entitlement and checkout lifecycle", () => {
  assert.match(source, /role="progressbar"/);
  assert.match(source, /completed/);
  assert.match(source, /reserved/);
  assert.match(source, /Upgrade to Early Access/);
  assert.match(source, /Manage billing/);
  assert.match(source, /Update payment method/);
  assert.match(source, /Online upgrades are temporarily unavailable/);
  assert.match(source, /checkoutBlockedReason/);
  assert.doesNotMatch(source, /Billing is not enabled yet/);
  assert.match(source, /Your plan activates after payment confirmation/);
  assert.match(source, /Checkout was cancelled/);
  assert.match(source, /Existing accepted work can finish/);
  assert.match(source, /Workspace owners and billing members/);
  assert.match(source, /id="workspace-plan-comparison"/);
  assert.match(source, /TOKENLESS_BILLING_PLANS\.free/);
  assert.match(source, /founding customers then receive 20% off/);
  assert.doesNotMatch(source, /href=\{`\/pricing\?workspace=/);
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
  assert.match(source, /<Field[\s\S]*id="workspace-prepaid-topup-amount"[\s\S]*format="usdInvoiceAmount"/);
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
  assert.match(source, /selected && canManageIdentity && identity\?\.enabled/);
  assert.doesNotMatch(source, /Enterprise identity is not enabled for this deployment/);
  assert.match(source, /Copy this SCIM bearer token now/);
  assert.match(source, /Publish this domain verification token/);
  assert.match(source, /<ConfirmDialog/);
  assert.doesNotMatch(source, /window\.confirm/);
});

test("workspace managers can create one-time scoped API keys without result webhooks", () => {
  assert.match(source, /<WorkspaceApiKeysPanel workspaceId=\{selected\.workspaceId\} \/>/);
  assert.match(source, /Create or revoke API key/);
  assert.doesNotMatch(source, /Manage API keys/);
  assert.match(source, /aria-expanded=\{showApiAccess\}/);
  assert.match(source, /showApiAccess \? \(/);
  assert.match(apiKeySource, /<OneTimeSecretNotice label="this API key"/);
  assert.match(apiKeySource, /New keys expire after 90 days and secrets are\s+stored only as hashes/);
  assert.match(apiKeySource, /setRevealedToken\(null\)/);
  assert.match(apiKeySource, /<ConfirmDialog/);
  assert.doesNotMatch(apiKeySource, /window\.confirm/);
  assert.doesNotMatch(apiKeySource, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /Result webhooks|\/webhooks/);
  assert.doesNotMatch(source, /Agent setup|Connect an agent once|RateLoop creates its bound access automatically/);
  assert.doesNotMatch(source, /Prepaid funds are usable only after settlement|Reserved amounts cannot be double-spent/);
  assert.equal(existsSync(apiKeyRoute), true);
  assert.equal(existsSync(webhookRoute), false);
});

test("workspace settings leaves active-workspace navigation to the agents tab header", () => {
  assert.doesNotMatch(source, /Active workspace/);
  assert.doesNotMatch(source, /useRouter|router\.push\(`\/agents\?tab=overview/);
});

test("billing and billing-profile loads are workspace-scoped like top-up and identity", () => {
  // AUD-04: every billing/profile request carries the same generation+workspace guard so a stale
  // response for a previous workspace can never overwrite the active workspace display.
  assert.match(source, /workspaceRequests\.begin\(workspaceId, "billing:load"\)/);
  assert.match(source, /workspaceRequests\.begin\(workspaceId, "billing:profile:load"\)/);
  assert.match(source, /if \(!request\.isCurrent\(\)\) return null;\s*setBilling\(next\)/);
  assert.match(source, /if \(!workspaceRequests\.isWorkspaceCurrent\(selectedId\)\) return;/);
});

test("workspace management creation continues into guided agent setup", () => {
  assert.match(source, /Create your workspace/);
  assert.match(source, /Name it, then connect your agent/);
  assert.match(source, /window\.location\.assign\(`\/agents\?workspace=.*&step=connect/);
  assert.match(source, /workspaces\.length === 0/);
  assert.match(source, /Create another workspace/);
  assert.match(source, /aria-labelledby="create-another-workspace-heading"/);
  assert.match(source, /aria-expanded=\{showWorkspaceCreation\}/);
  assert.match(source, /showWorkspaceCreation \? <div id="create-workspace-form">/);
  assert.match(source, /sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(source, /<details[^>]*>\s*<summary[^>]*>Create another workspace/);
  assert.doesNotMatch(source, /rateloop-gradient-action mt-3 w-full/);
  assert.doesNotMatch(source, /Create a workspace to fund panels/);
});
