import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const activeDocs = {
  "docs/use-cases-2026-06.md": readFileSync(
    new URL("../docs/use-cases-2026-06.md", import.meta.url),
    "utf8",
  ),
  "docs/ux-review-multi-agent-2026-07-03.md": readFileSync(
    new URL(
      "../docs/ux-review-multi-agent-2026-07-03.md",
      import.meta.url,
    ),
    "utf8",
  ),
};

const publicDocs = {
  "packages/nextjs/public/docs/ai.md": readFileSync(
    new URL("../packages/nextjs/public/docs/ai.md", import.meta.url),
    "utf8",
  ),
  "packages/nextjs/public/docs/sdk.md": readFileSync(
    new URL("../packages/nextjs/public/docs/sdk.md", import.meta.url),
    "utf8",
  ),
  "packages/nextjs/public/llms.txt": readFileSync(
    new URL("../packages/nextjs/public/llms.txt", import.meta.url),
    "utf8",
  ),
};

const publicSkill = readFileSync(
  new URL("../packages/nextjs/public/skill.md", import.meta.url),
  "utf8",
);
const agentSkillsIndex = readFileSync(
  new URL(
    "../packages/nextjs/public/.well-known/agent-skills/index.json",
    import.meta.url,
  ),
  "utf8",
);
const landingFaq = readFileSync(
  new URL("../packages/nextjs/lib/docs/landingFaq.ts", import.meta.url),
  "utf8",
);
const oracleChallengeFlowDiagram = readFileSync(
  new URL(
    "../packages/nextjs/components/docs/OracleChallengeFlowDiagram.tsx",
    import.meta.url,
  ),
  "utf8",
);
const docsIndexPage = readFileSync(
  new URL("../packages/nextjs/app/(public)/docs/page.tsx", import.meta.url),
  "utf8",
);
const agentsEnvExample = readFileSync(
  new URL("../packages/agents/.env.example", import.meta.url),
  "utf8",
);
const governanceDocsPage = readFileSync(
  new URL(
    "../packages/nextjs/app/(public)/docs/governance/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const betaNoticeBanner = readFileSync(
  new URL(
    "../packages/nextjs/components/BetaNoticeBanner.tsx",
    import.meta.url,
  ),
  "utf8",
);
const protocolReleaseConstants = readFileSync(
  new URL("../packages/nextjs/constants/protocolRelease.ts", import.meta.url),
  "utf8",
);
const agentAskHandoffPage = readFileSync(
  new URL(
    "../packages/nextjs/components/agent/AgentAskHandoffPage.tsx",
    import.meta.url,
  ),
  "utf8",
);
const docsHowItWorksPage = readFileSync(
  new URL(
    "../packages/nextjs/app/(public)/docs/how-it-works/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const publicHowItWorksDoc = readFileSync(
  new URL("../packages/nextjs/public/docs/how-it-works.md", import.meta.url),
  "utf8",
);
const docsSmartContractsPage = readFileSync(
  new URL(
    "../packages/nextjs/app/(public)/docs/smart-contracts/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const whitepaperSections = readFileSync(
  new URL("../packages/nextjs/scripts/whitepaper/sections.ts", import.meta.url),
  "utf8",
);
const keeperReadme = readFileSync(
  new URL("../packages/keeper/README.md", import.meta.url),
  "utf8",
);
const ponderReadme = readFileSync(
  new URL("../packages/ponder/README.md", import.meta.url),
  "utf8",
);
const ponderEnvExample = readFileSync(
  new URL("../packages/ponder/.env.example", import.meta.url),
  "utf8",
);

test("active public docs avoid stale chain and mandatory credential copy", () => {
  for (const [file, content] of Object.entries(activeDocs)) {
    assert.doesNotMatch(content, /World App rater base/i, file);
    assert.doesNotMatch(content, /World ID-gated/i, file);
    assert.doesNotMatch(content, /~2s blocks/i, file);
  }
});

test("static public docs identify Base mainnet production only", () => {
  for (const [file, content] of Object.entries(publicDocs)) {
    assert.match(content, /Base mainnet.*8453|8453.*Base mainnet/i, file);
    assert.doesNotMatch(content, /testnet validation/i, file);
  }
});

test("static agent docs keep no-payment dry-run guidance", () => {
  for (const file of [
    "packages/nextjs/public/docs/ai.md",
    "packages/nextjs/public/llms.txt",
  ]) {
    const content = publicDocs[file];
    assert.match(content, /dryRun: true/, file);
    assert.match(content, /dry_run|rateloop-agents sandbox/, file);
  }
});

test("public AI docs use published-package example paths and Node 24", () => {
  const docsAiPage = readFileSync(
    new URL("../packages/nextjs/app/(public)/docs/ai/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(docsAiPage, /Node 24/);
  assert.match(docsAiPage, /node_modules\/@rateloop\/agents\/examples\/questions\/landing-pitch-review\.json/);
  assert.doesNotMatch(docsAiPage, /npx rateloop-agents sandbox --file packages\/agents\/examples/);
});

test("static agent docs mention optional 16:9 image guidance", () => {
  for (const file of [
    "packages/nextjs/public/docs/ai.md",
    "packages/nextjs/public/docs/sdk.md",
    "packages/nextjs/public/llms.txt",
  ]) {
    assert.match(publicDocs[file], /Prefer 16:9/i, file);
    assert.match(publicDocs[file], /other ratios are allowed/i, file);
  }
});

test("public agent copy keeps open-rater and LREP-or-USDC wallet-call framing", () => {
  assert.match(
    landingFaq,
    /public agent wallet-call flows can fund protocol escrow in LREP or USDC/,
  );
  assert.match(landingFaq, /EIP-3009 authorization remains the USDC one-shot path/);
  assert.doesNotMatch(landingFaq, /Extra USDC/);
  assert.doesNotMatch(landingFaq, /optional USDC Feedback Bonus/);

  assert.match(
    oracleChallengeFlowDiagram,
    /LREP or USDC bounty and launch LREP claim paths/,
  );
  assert.match(publicSkill, /LREP or USDC bounty claims wait for finalized payout roots/);
  assert.doesNotMatch(publicSkill, /USDC bounties wait for finalized payout roots/);

  assert.match(agentSkillsIndex, /open human and AI raters/);
  assert.doesNotMatch(agentSkillsIndex, /Ask verified humans/);
  assert.match(docsIndexPage, /open human raters, AI raters, or optional verified-human cohorts/);
  assert.doesNotMatch(docsIndexPage, /verified humans in the loop, or from other agents/);
  assert.match(agentsEnvExample, /Base mainnet LREP or USDC/);
  assert.match(agentsEnvExample, /EIP-3009 one-shot asks require USDC/);
});

test("generic bounty copy stays asset-neutral outside x402-only paths", () => {
  assert.match(agentAskHandoffPage, /LREP or USDC amount funded from the connected wallet/);
  assert.match(agentAskHandoffPage, /positive LREP or USDC amount/);
  assert.doesNotMatch(agentAskHandoffPage, /"USDC amount funded from the connected wallet/);
  assert.doesNotMatch(agentAskHandoffPage, /positive USDC amount with up to 6 decimals\./);

  assert.match(docsHowItWorksPage, /Bounty payout timing/);
  assert.match(docsHowItWorksPage, /Bounty claim weights/);
  assert.doesNotMatch(docsHowItWorksPage, /USDC payout timing/);
  assert.doesNotMatch(docsHowItWorksPage, /USDC claim weights/);
  assert.match(publicHowItWorksDoc, /bounty and launch LREP claim weights/);
  assert.doesNotMatch(publicHowItWorksDoc, /USDC and launch LREP claim weights/);
  assert.match(docsSmartContractsPage, /LREP or USDC bounty claims/);
  assert.doesNotMatch(docsSmartContractsPage, /payout snapshots for USDC claims/);

  assert.match(whitepaperSections, /fund LREP or USDC for wallet-call bounties/);
  assert.match(whitepaperSections, /LREP or USDC bounty payouts/);
  assert.match(whitepaperSections, /LREP or USDC bounty claims and launch LREP claims/);
  assert.doesNotMatch(whitepaperSections, /fund USDC for bounties/);
  assert.doesNotMatch(whitepaperSections, /USDC payouts, and launch LREP payouts/);
  assert.doesNotMatch(whitepaperSections, /USDC bounty and launch LREP claims/);
});

test("fresh redeploy runbooks do not present stale stacks or blockhash pairing as current", () => {
  assert.match(keeperReadme, /owner-directed fresh deployment artifacts/);
  assert.doesNotMatch(keeperReadme, /preserve the existing deployed contract stack/);
  assert.match(keeperReadme, /settled LREP or USDC bounty rounds/);
  assert.doesNotMatch(keeperReadme, /settled USDC bounty rounds/);
});

test("historical use-case snapshot does not label gated AI constraints as current", () => {
  const useCases = activeDocs["docs/use-cases-2026-06.md"];
  assert.match(useCases, /Capability envelope at snapshot time/);
  assert.match(useCases, /Snapshot-time note/);
  assert.match(useCases, /Adoption blockers that remained at snapshot time/);
  assert.doesNotMatch(useCases, /still 404 on npm/);
  assert.doesNotMatch(useCases, /Capability envelope \(current\)/);
  assert.doesNotMatch(useCases, /Note: gated\/private-context rounds currently require/);
});

test("governance docs frame Base mainnet contracts as durable infrastructure", () => {
  assert.match(
    governanceDocsPage,
    /Base mainnet contracts are live production infrastructure/,
  );
  assert.doesNotMatch(governanceDocsPage, /release candidate/i);
  assert.doesNotMatch(governanceDocsPage, /redeploy/i);
  assert.doesNotMatch(betaNoticeBanner, /release candidate/i);
  assert.doesNotMatch(protocolReleaseConstants, /release candidate/i);
  assert.match(protocolReleaseConstants, /mainnet-beta/);
});

test("Ponder README says live override conflicts fail closed", () => {
  assert.match(ponderReadme, /Conflicting live-chain overrides fail startup/);
  assert.doesNotMatch(ponderReadme, /ignores stale address\/start-block/i);
});

test("Ponder schema docs prefer deployment-scoped live schemas", () => {
  assert.match(ponderReadme, /leave `RATELOOP_PONDER_DATABASE_SCHEMA` and `DATABASE_SCHEMA` unset/i);
  assert.match(ponderReadme, /protocol deployment-scoped schema/i);
  assert.match(ponderEnvExample, /Leave unset for normal live[\s#]+services/i);
  assert.match(ponderEnvExample, /protocol deployment-scoped schemas/i);
  assert.doesNotMatch(ponderEnvExample, /RATELOOP_PONDER_DATABASE_SCHEMA=rateloop_ponder_base_sepolia/);
});
