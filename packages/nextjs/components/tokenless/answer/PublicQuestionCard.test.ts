import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const reviewMessages = readFileSync(new URL("../../../messages/en/review.json", import.meta.url), "utf8");
const source = [readFileSync(new URL("./PublicQuestionCard.tsx", import.meta.url), "utf8"), reviewMessages].join("\n");
const crowdForecastSource = [
  readFileSync(new URL("../review/CrowdForecastField.tsx", import.meta.url), "utf8"),
  reviewMessages,
].join("\n");

test("public rating progressively collects feedback without LREP and explains the exact privacy timing", () => {
  assert.match(source, /t\("ratingPrivacy"\)/);
  assert.match(source, /Add feedback/);
  assert.match(source, /Optional feedback/);
  assert.match(source, /Feedback required/);
  assert.match(source, /Feedback category/);
  assert.match(source, /Source URL/);
  assert.match(source, /feedbackEnabled = task\.question\.rationale\?\.mode !== "off"/);
  assert.match(source, /\{feedbackEnabled &&/);
  assert.doesNotMatch(source, /\bLREP\b/);
  assert.match(source, /Quality bonus up to/);
  assert.match(source, /Conditional surprise bonus up to/);
  assert.doesNotMatch(source, /RBTS up to|Surprise up to/);
});

test("an already reserved voucher retries the prepared device queue and waits for confirmation", () => {
  assert.match(source, /What becomes public/);
  assert.match(
    source,
    /tlock ciphertext containing your vote, crowd forecast, response\s+hash, per-round payout address, and salt/,
  );
  assert.match(source, /publicly decryptable after the commit deadline/);
  assert.match(source, /even if no keeper or reviewer submits a reveal/);
  assert.match(source, /A reveal publishes the plaintext/);
  assert.match(source, /Public blockchain\s+records generally cannot be erased/);
  assert.match(source, /href="\/legal\/privacy#on-chain-data"/);
  assert.match(source, /\{answer \? \(\s*<section[\s\S]*What becomes public/);
  assert.ok(source.indexOf('t("publicTitle")') < source.indexOf("{recoveryUrl && activePreparedSubmission"));
  assert.match(source, /dueTokenlessCommits\(queue, principalId\)/);
  assert.match(source, /queue\.list\(principalId\)/);
  assert.match(source, /recordTokenlessCommitRelayFailure/);
  assert.match(source, /Retry submission/);
  assert.match(source, /\/api\/rater\/commits\/\$\{encodeURIComponent/);
  assert.match(source, /confirmation_pending/);
  assert.match(source, /Retry scheduled/);
  assert.match(source, /remove\(currentRecord\.queueId, principalId\)/);
  assert.match(source, /<ReviewerShell/);
  assert.match(source, /<DeadlineChip/);
  assert.match(source, /loadReviewDraft\("public"/);
  assert.match(source, /saveReviewDraft\(\s*"public"/);
  assert.match(source, /clearReviewDraft\("public"/);
  assert.match(source, /publicDraftStorage = useMemo\(\(\) => \(\{ principalId \}\)/);
  assert.match(source, /generateDeviceRecoverySecret\(\)/);
  assert.match(source, /readBrowserSession\(\)/);
  assert.match(source, /principalId: browserSession\.principalId/);
  assert.match(
    source,
    /storeDeviceRecovery\(\s*activePreparedSubmission\.recoveryRecord,\s*browserSession\.principalId/,
  );
  assert.match(source, /serializeDeviceRecoveryBackup\(recoveryRecord, recoverySecret\)/);
  assert.match(source, /Create recovery backup/);
  assert.match(source, /Download recovery backup/);
  assert.match(source, /I saved the recovery backup/);
  assert.match(source, /No voucher or commit is requested until you confirm the backup/);
  assert.match(source, /async function prepareRecoveryBackup/);
  assert.match(source, /async function confirmRecoveryBackup/);
  assert.match(source, /async function submitPreparedResponse/);
  assert.match(source, /Submitting…/);
  assert.match(source, /Recorded/);
  assert.match(source, /Commit receipt/);
  assert.match(source, /View confirmed transaction/);
  assert.doesNotMatch(source, /Technical details|technicalStatus|setTechnicalStatus/);
  assert.doesNotMatch(source, /Recovery secret/);
});

test("binary review instructions stay neutral for feedback questions", () => {
  assert.match(source, /Choose one answer, then estimate how the panel will respond/);
  assert.doesNotMatch(source, /Choose the stronger answer/);
});

test("the blind crowd forecast accepts the full one-percent RBTS grid without a default", () => {
  assert.match(source, /<CrowdForecastField/);
  assert.match(source, /positiveLabel=\{options\[0\]\}/);
  assert.match(crowdForecastSource, /Crowd forecast/);
  assert.match(crowdForecastSource, /t\("question", \{ label: positiveLabel \}\)/);
  assert.match(crowdForecastSource, /What percentage of reviewers do you expect to choose “\{label\}”\?/);
  assert.match(crowdForecastSource, /min=\{1\}/);
  assert.match(crowdForecastSource, /max=\{99\}/);
  assert.match(crowdForecastSource, /step=\{1\}/);
  assert.match(crowdForecastSource, /value=\{value \?\? ""\}/);
  assert.match(crowdForecastSource, /No forecast is preselected/);
  assert.match(source, /privacyContext=\{PUBLIC_PAID_REVIEW_PRIVACY_CONTEXT\}/);
  assert.match(source, /predictedUpBps: prediction \* 100/);
  assert.doesNotMatch(crowdForecastSource, /\[10, 30, 50, 70, 90\]/);
});

test("confirmation control ids are scoped per task so queued cards cannot cross-toggle", () => {
  const source = readFileSync(new URL("./PublicQuestionCard.tsx", import.meta.url), "utf8");
  // AnswerPageClient renders one card per queued task. A literal id makes every `htmlFor` bind to
  // the first card in tree order, so clicking the second card's confirmation toggles the first.
  assert.doesNotMatch(source, /"public-review-terms"/u);
  assert.doesNotMatch(source, /"public-review-recovery-confirmed"/u);
  assert.match(source, /public-review-terms-\$\{task\.roundId\}/u);
  assert.match(source, /public-review-recovery-confirmed-\$\{task\.roundId\}/u);
});
