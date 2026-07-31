import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = [
  readFileSync(new URL("./AccountDeletionPanel.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../../messages/en/account.json", import.meta.url), "utf8"),
].join("\n");
const settingsPageSource = readFileSync(
  new URL("../../../app/[locale]/(app)/human/HumanSectionPage.tsx", import.meta.url),
  "utf8",
);

test("account deletion exposes its action and requires the server preview", () => {
  assert.match(panelSource, /<Card as="section"[^>]+aria-labelledby="account-deletion-heading"/);
  assert.match(panelSource, /Review account deletion/);
  assert.match(panelSource, /onClick=\{startDeletionReview\}/);
  assert.match(panelSource, /\{reviewing \? \(/);
  assert.doesNotMatch(panelSource, /<details/);
  assert.match(panelSource, /fetch\("\/api\/account\/deletion", \{ credentials: "same-origin", cache: "no-store" \}\)/);
  assert.match(panelSource, /preview\.blockers\.length > 0/);
});

test("account deletion requires a literal confirmation and clears client authentication", () => {
  assert.match(panelSource, /confirmation !== "DELETE"/);
  assert.match(panelSource, /issueAccountDeletionProof\(\)/);
  assert.match(panelSource, /body: JSON\.stringify\(\{ confirmation: "DELETE", recentAuthProof \}\)/);
  assert.match(panelSource, /betterAuthClient\.signOut\(\)/);
  assert.match(panelSource, /window\.location\.assign\(locale === "en" \? "\/" : `\/\$\{locale\}`\)/);
  assert.match(panelSource, /same email address, creates a new/);
  assert.match(panelSource, /Public blockchain entries and records required for legal, tax, settlement/);
});

test("human settings render account deletion after notifications", () => {
  assert.match(
    settingsPageSource,
    /<NotificationSettingsPanel \/>\s*<SubjectDataExportPanel \/>\s*<AccountDeletionPanel \/>/,
  );
});
