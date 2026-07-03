import { EXECUTIVE_SUMMARY, META, SECTIONS } from "../../scripts/whitepaper/content";
import type { ContentBlock } from "../../scripts/whitepaper/types";
import assert from "node:assert/strict";
import test from "node:test";

function collectBlockText(block: ContentBlock): string[] {
  switch (block.type) {
    case "paragraph":
    case "sub_heading":
      return [block.text];
    case "bullets":
    case "ordered":
      return block.items;
    case "formula":
      return [block.latex];
    case "table":
      return [...block.data.headers, ...block.data.rows.flat()];
  }
}

function collectWhitepaperText(): string {
  const parts = [META.title, META.subtitle, META.deck, META.author, META.version, META.date];

  for (const block of EXECUTIVE_SUMMARY) {
    parts.push(...collectBlockText(block));
  }

  for (const section of SECTIONS) {
    parts.push(section.title, section.lead);

    for (const subsection of section.subsections) {
      parts.push(subsection.heading);

      for (const block of subsection.blocks) {
        parts.push(...collectBlockText(block));
      }
    }
  }

  return parts.join("\n");
}

test("whitepaper metadata reflects the agent-first brand deck", () => {
  assert.equal(META.title, "RateLoop Whitepaper");
  assert.equal(META.subtitle, "Level Up Your Agent");
  assert.equal(META.deck, "Human and AI raters guide decisions and earn LREP or USDC");
});

test("whitepaper metadata reflects the May 2026 product and AI revision", () => {
  assert.equal(META.version, "0.6");
  assert.equal(META.date, "May 2026");
});

test("whitepaper reflects current launch allocations and governance threshold", () => {
  const whitepaperText = collectWhitepaperText();

  assert.match(whitepaperText, /Launch Distribution Pool \(75M LREP\)/i);
  assert.match(whitepaperText, /treasury starts with 25M LREP/i);
  assert.match(whitepaperText, /bootstrap proposal threshold is 1,000 LREP/i);
  assert.match(whitepaperText, /42M LREP for verified \+ referral rewards/i);
  assert.match(whitepaperText, /24M LREP for earned rater rewards/i);
  assert.match(whitepaperText, /9M LREP for legacy contributor vesting/i);
  assert.match(whitepaperText, /1% immediately claimable, 99% linearly unlocked over 24 months/i);
  assert.match(whitepaperText, /27-month claim window/i);
  assert.match(whitepaperText, /unclaimed balances become treasury-recoverable/i);
  assert.match(whitepaperText, /one verified-human anchor in the round/i);
  assert.match(whitepaperText, /minimum launch-credit stake/i);
  assert.match(whitepaperText, /two distinct verified-human anchors/i);
  assert.match(whitepaperText, /bounded anchor fanout/i);
  assert.match(whitepaperText, /round-level unverified-credit caps/i);
  assert.match(whitepaperText, /aged anchor credentials/i);
  assert.match(whitepaperText, /500 LREP for eligible raters 1-100/i);
  assert.match(whitepaperText, /first-100 open-lane raters can earn up to 125 LREP/i);
  assert.match(whitepaperText, /claims 1-100 receive 250 LREP/i);
  assert.match(whitepaperText, /about 10\.94M fully paid earned-rater recipients/i);
  assert.match(whitepaperText, /agent wallets do not count as human anchors unless/i);

  assert.doesNotMatch(whitepaperText, /Bootstrap Pool \(12M LREP\)/i);
  assert.doesNotMatch(whitepaperText, /Bootstrap Pool \(24M LREP\)/i);
  assert.doesNotMatch(whitepaperText, /pool is funded with 24M LREP/i);
  assert.doesNotMatch(whitepaperText, /Launch Distribution Pool \(64M LREP\)/i);
  assert.doesNotMatch(whitepaperText, /29M LREP for earned rater rewards/i);
  assert.doesNotMatch(whitepaperText, /25M LREP for earned rater rewards/i);
  assert.doesNotMatch(whitepaperText, /4M LREP for legacy users/i);
  assert.doesNotMatch(whitepaperText, /Launch Distribution Pool \(68M LREP\)/i);
  assert.doesNotMatch(whitepaperText, /treasury starts with 32M LREP/i);
  assert.doesNotMatch(whitepaperText, /consensus subsidy reserve/i);
  assert.doesNotMatch(whitepaperText, /treasury starts with 20M LREP/i);
  assert.doesNotMatch(whitepaperText, /10,000 LREP proposal threshold/i);
  assert.doesNotMatch(whitepaperText, /bootstrap proposal threshold is 10,000 LREP/i);
  assert.doesNotMatch(whitepaperText, /Full earned-rater caps start at 10 LREP/i);
  assert.doesNotMatch(whitepaperText, /11\.8M fully paid earned-rater recipients/i);
  assert.doesNotMatch(whitepaperText, /Calibration rounds gate USDC earning/i);
  assert.doesNotMatch(whitepaperText, /USDC earning starts after the required calibration rounds/i);
});

test("whitepaper introduction surfaces the updated lead copy", () => {
  assert.equal(SECTIONS[0]?.title, "Introduction");
  assert.equal(
    SECTIONS[0]?.lead,
    "RateLoop is a public, paid prediction-rating layer for agents and AI product teams.",
  );
});

test("whitepaper contents include the current nine sections", () => {
  assert.equal(SECTIONS.length, 9);
  assert.deepEqual(
    SECTIONS.map(section => section.title),
    [
      "Introduction",
      "Why Agents Need Human Judgment",
      "How RateLoop Works",
      "Product Experience",
      "Signal Integrity",
      "Incentives & Token Flows",
      "Agent Interfaces",
      "Governance & Public Infrastructure",
      "Limitations & Future Work",
    ],
  );
});

test("whitepaper includes how-it-works formulas as rendered formula blocks", () => {
  const incentives = SECTIONS.find(section => section.title === "Incentives & Token Flows");
  assert.ok(incentives);
  const whitepaperText = collectWhitepaperText();

  const allFormulaLatex = incentives.subsections
    .flatMap(subsection => subsection.blocks)
    .filter((block): block is Extract<ContentBlock, { type: "formula" }> => block.type === "formula")
    .map(block => block.latex);

  assert.ok(allFormulaLatex.some(latex => latex.includes(String.raw`b_i = \frac{\sum_j w_j`)));
  assert.ok(allFormulaLatex.some(latex => latex.includes(String.raw`f_i = \begin{cases}`)));
  assert.ok(allFormulaLatex.some(latex => latex.includes(String.raw`r_i = 0.96`)));
  assert.ok(allFormulaLatex.some(latex => latex.includes(String.raw`\mathrm{claim}_i`)));
  assert.ok(allFormulaLatex.some(latex => latex.includes(String.raw`\mathrm{credit}_r`)));
  assert.ok(allFormulaLatex.some(latex => latex.includes(String.raw`\mathrm{payout}`)));
  assert.ok(allFormulaLatex.some(latex => latex.includes(String.raw`w_i = \mathrm{clusterBudget}_{c,s}`)));
  assert.match(whitepaperText, /stake rewards follow relative predictive quality rather than raw popularity/i);
  assert.match(whitepaperText, /buys scarce, informative judgment/i);
});

test("whitepaper documents pinned correlation artifact inputs", () => {
  const whitepaperText = collectWhitepaperText();

  assert.match(whitepaperText, /pinned source-event input snapshots/i);
  assert.match(whitepaperText, /artifact v3 commits each epoch parameter hash/i);
  assert.match(
    whitepaperText,
    /governance can still reject a consumed root until the finalization veto window elapses/i,
  );
  assert.match(whitepaperText, /shorter windows improve claim speed but narrow the review period/i);
  assert.doesNotMatch(whitepaperText, /rateloop-correlation-epoch-v2/i);
  assert.doesNotMatch(whitepaperText, /consumed root cannot be rejected through the veto path/i);
});

test("whitepaper executive summary centers the agent-first thesis", () => {
  const whitepaperText = collectWhitepaperText();

  assert.match(whitepaperText, /public, paid prediction-rating layer/i);
  assert.match(whitepaperText, /Level Up Your Agent/i);
  assert.match(whitepaperText, /Human and AI raters guide decisions and earn LREP or USDC/i);
  assert.match(whitepaperText, /structured result templates/i);
  assert.match(whitepaperText, /all-answer scope/i);
  assert.match(whitepaperText, /bounty-eligible answer scope/i);
});

test("whitepaper surfaces the agent integration path", () => {
  const whitepaperText = collectWhitepaperText();

  assert.match(whitepaperText, /accountless by default/i);
  assert.match(whitepaperText, /Public MCP/i);
  assert.match(whitepaperText, /direct JSON routes/i);
  assert.match(whitepaperText, /eip3009_usdc_authorization/i);
  assert.match(whitepaperText, /browser signing/i);
  assert.match(whitepaperText, /local signer CLI/i);
  assert.match(whitepaperText, /rateloop_quote_question/i);
  assert.match(whitepaperText, /rateloop_confirm_ask_transactions/i);
  assert.match(whitepaperText, /rateloop_get_result/i);
  assert.match(whitepaperText, /\/api\/agent\/signing-intents/i);
  assert.match(whitepaperText, /Feedback Bonuses/i);
});

test("whitepaper reflects the current AI template catalog", () => {
  const whitepaperText = collectWhitepaperText();

  for (const templateId of [
    "llm_answer_quality",
    "rag_grounding_check",
    "claim_verification",
    "source_credibility_check",
    "agent_action_go_no_go",
    "feature_acceptance_test",
    "agent_trace_review",
    "proposal_review",
    "pairwise_output_preference",
  ]) {
    assert.match(whitepaperText, new RegExp(templateId, "i"));
  }
});

test("whitepaper reflects the current product design surface", () => {
  const whitepaperText = collectWhitepaperText();

  assert.match(whitepaperText, /agent-first ask -> open rating loop/i);
  assert.match(whitepaperText, /app sidebar shell/i);
  assert.match(whitepaperText, /\/ask\?tab=agent/i);
  assert.match(whitepaperText, /\/agent\/sign\/\{intentId\}/i);
  assert.match(whitepaperText, /For Humans and For Agents/i);
});

test("whitepaper removes legacy section framing", () => {
  const whitepaperText = collectWhitepaperText();

  for (const stalePhrase of [
    /tlock Commit-Reveal Voting/i,
    /^Tokenomics$/im,
    /RateLoop & AI/i,
    /Rating Research Basis/i,
    /decentralized content curation protocol/i,
    /World Chain clock/i,
  ]) {
    assert.doesNotMatch(whitepaperText, stalePhrase);
  }

  assert.match(whitepaperText, /question-first/i);
  assert.match(whitepaperText, /LREP or USDC on a configured supported network/i);
  assert.doesNotMatch(whitepaperText, /USDC on World Chain/i);
  assert.match(whitepaperText, /public infrastructure/i);
});

test("whitepaper reflects the current private-context trust model", () => {
  const whitepaperText = collectWhitepaperText();

  assert.match(whitepaperText, /RateLoop-hosted gated context/i);
  assert.match(whitepaperText, /operators and compromised serving infrastructure can see hosted bytes/i);
  assert.match(whitepaperText, /Private-context asks are operator-trust by design/i);
  assert.doesNotMatch(whitepaperText, /current design assumes public context URLs/i);
  assert.doesNotMatch(whitepaperText, /public context URLs and public settled result pages rather than private/i);
});
