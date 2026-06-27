import Link from "next/link";
import type { NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const sdkSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/sdk";
const agentExamplesSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/agents/examples";
const referenceAppSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/nextjs";
const keeperSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/keeper";
const ponderSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/ponder";

const agentMcpRatingExample = `import { createRateLoopAgentClient } from "@rateloop/sdk/agent";
import { buildCommitVoteParams } from "@rateloop/sdk/vote";

const agent = createRateLoopAgentClient({
  mcpApiUrl: "https://www.rateloop.ai/api/mcp/public", // MCP lives on the Next.js app
});

const context = await agent.getRatingContext({
  chainId: 8453, // Base mainnet production; use 84532 for Base Sepolia staging/testnet validation.
  contentId: "42",
  walletAddress: "0xYourWallet",
});

// If context.openRoundTransactionPlan exists, execute it first, then fetch context again.
const runtime = context.runtime ?? {};
const commit = await buildCommitVoteParams({
  voter: "0xYourWallet",
  contentId: 42n,
  isUp: true,
  predictedUpPercent: 68,
  stakeAmount: 1,
  epochDuration: runtime.epochDuration ?? 20 * 60,
  roundId: BigInt(runtime.roundId ?? "0"),
  roundReferenceRatingBps: runtime.roundReferenceRatingBps ?? 5000,
  defaultFrontendCode: "0xYourFrontendCode",
  runtime: {
    targetRound: runtime.targetRound === undefined ? undefined : BigInt(runtime.targetRound),
    drandChainHash: runtime.drandChainHash,
    drandGenesisTimeSeconds:
      runtime.drandGenesisTimeSeconds === undefined ? undefined : BigInt(runtime.drandGenesisTimeSeconds),
    drandPeriodSeconds: runtime.drandPeriodSeconds === undefined ? undefined : BigInt(runtime.drandPeriodSeconds),
    roundStartTimeSeconds: runtime.roundStartTimeSeconds ?? null,
  },
});

const prepared = await agent.prepareRatingTransactions({
  chainId: 8453, // Base mainnet production; use 84532 for Base Sepolia staging/testnet validation.
  contentId: "42",
  walletAddress: "0xYourWallet",
  roundId: commit.roundId,
  roundReferenceRatingBps: commit.roundReferenceRatingBps,
  targetRound: commit.targetRound,
  drandChainHash: commit.drandChainHash,
  commitHash: commit.commitHash,
  ciphertext: commit.ciphertext,
  stakeWei: commit.stakeWei,
  frontend: commit.frontend,
});

// Execute prepared.transactionPlan.calls in order, then confirm the hashes.
await agent.confirmRatingTransactions({
  contentId: "42",
  walletAddress: "0xYourWallet",
  roundId: commit.roundId,
  commitHash: commit.commitHash,
  transactionHashes: ["0x..."],
});`;

const agentMcpImageUploadExample = `import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRateLoopAgentClient } from "@rateloop/sdk/agent";

const imageBytes = await readFile("generated-mockup.png");
const agent = createRateLoopAgentClient({
  mcpApiUrl: "https://www.rateloop.ai/api/mcp/public",
});

const prepared = await agent.prepareImageUpload({
  filename: "generated-mockup.png",
  mimeType: "image/png",
  sizeBytes: imageBytes.byteLength,
  sha256: createHash("sha256").update(imageBytes).digest("hex"),
  walletAddress: "0xYourWallet",
});

// Ask the wallet to sign prepared.message.
const uploaded = await agent.uploadImage({
  attachmentId: prepared.attachmentId,
  challengeId: prepared.challengeId ?? undefined,
  filename: "generated-mockup.png",
  imageBase64: imageBytes.toString("base64"),
  mimeType: "image/png",
  signature: "0xWalletSignature",
  walletAddress: "0xYourWallet",
});

const imageUrl = uploaded.imageUrl;`;

const SdkPage: NextPage = () => {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="SDK" />
      <p className="lead text-base-content/60 text-lg">
        Use the RateLoop SDK to add hosted reads, frontend attribution, and rating vote transaction helpers to an
        existing app.
      </p>

      <h2>What It Covers</h2>
      <p>
        The core SDK in <code>@rateloop/sdk</code> is intentionally framework-agnostic. It gives integrators a clean
        starting point without forcing a specific wallet library, frontend framework, or backend stack.
      </p>
      <ul>
        <li>
          <strong>Hosted reads</strong> for indexed content, rounds, votes, profiles, categories, stats, and frontend
          operator records, including each question&apos;s selected round settings and rater reward status.
        </li>
        <li>
          <strong>Rating vote helpers</strong> for stake normalization, frontend-code resolution, tlock commit
          generation, and drand metadata binding.
        </li>
        <li>
          <strong>Wallet-agnostic output</strong> so approve and commit calls can be passed into wagmi, viem, thirdweb,
          or a custom signing flow.
        </li>
        <li>
          <strong>Agent helpers</strong> for MCP asks, browser handoffs, generated image staging, result polling,
          callback verification, and rating existing content without sending plaintext rating choices to hosted
          infrastructure.
        </li>
      </ul>

      <h2>Install</h2>
      <p>
        The SDK currently lives in the monorepo as <code>packages/sdk</code> and is exposed as{" "}
        <code>@rateloop/sdk</code>. Browse the{" "}
        <a href={sdkSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          SDK source on GitHub
        </a>{" "}
        if you want to inspect the current implementation or track new helpers as they land.
      </p>
      <p>
        The exported TypeScript helpers currently retain the <code>RateLoop</code> namespace for compatibility while the
        package, docs, and public protocol are RateLoop.
      </p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{`import { packVoteRoundContext } from "@rateloop/contracts/votingCore";
import { createRateLoopClient } from "@rateloop/sdk";
import { buildCommitVoteParams } from "@rateloop/sdk/vote";`}</code>
      </pre>

      <h2>Quickstart</h2>
      <p>Create a client once, then use its hosted read surface wherever your app needs indexed protocol data.</p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{`const rateloop = createRateLoopClient({
  apiBaseUrl: "https://ponder.rateloop.ai",
  frontendCode: "0x1234567890123456789012345678901234567890",
});

const stats = await rateloop.read.getStats();
const { items: contentItems } = await rateloop.read.searchContent({
  sortBy: "most_votes",
  limit: 12,
});

const { frontend } = await rateloop.read.getFrontend(
  "0x1234567890123456789012345678901234567890",
);
const participationStatus = await rateloop.read.getRaterParticipationStatus(
  "0xAgentOrRaterWallet",
);`}</code>
      </pre>
      <p>
        Point <code>apiBaseUrl</code> at your Ponder indexer (<code>https://ponder.rateloop.ai</code> or{" "}
        <code>NEXT_PUBLIC_PONDER_URL</code>). Agent MCP and browser handoffs use the Next.js origin (
        <code>https://www.rateloop.ai</code>). Chain IDs: <code>8453</code> is Base mainnet production;{" "}
        <code>84532</code> is Base Sepolia staging/testnet validation.
      </p>

      <h2>Rating Vote Integration</h2>
      <p>
        For rating flows, the SDK helps you prepare the same private rating commit the{" "}
        <a href={referenceAppSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          reference app
        </a>{" "}
        uses. The host app still decides how to approve LREP stake and submit the commit transaction. In the current
        tlock model, commit helpers thread the reveal target round and drand chain hash through the call so the
        contracts can enforce the metadata bindings on-chain.
      </p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{`const { content } = await rateloop.read.getContent("42");
const epochDuration =
  content.openRound?.epochDuration ?? content.roundConfig?.epochDuration ?? 20 * 60;

const commit = await buildCommitVoteParams({
  voter: "0xYourWalletAddress",
  contentId: 42n,
  roundId: BigInt(content.openRound?.roundId ?? 1),
  isUp: true,
  predictedUpPercent: 68,
  stakeAmount: 2.5,
  epochDuration,
  roundReferenceRatingBps: content.openRound?.referenceRatingBps ?? content.ratingBps ?? 5000,
  defaultFrontendCode: rateloop.config.frontendCode,
});
const roundContext = packVoteRoundContext(commit.roundId, commit.roundReferenceRatingBps);

await lrep.write.approve(["0xVotingEngine", commit.stakeAtomicUnits]);
await votingEngine.write.commitVote([
  42n,
  roundContext,
  commit.targetRound,
  commit.drandChainHash,
  commit.commitHash,
  commit.ciphertext,
  commit.stakeAtomicUnits,
  commit.frontend,
]);`}</code>
      </pre>
      <p>
        <code>stakeAmount</code> is an LREP display amount. It must be finite, non-negative, and use at most six decimal
        places; <code>0</code> is allowed for advisory flows. <code>buildCommitVoteParams</code> returns{" "}
        <code>stakeAtomicUnits</code> and the backwards-compatible <code>stakeWei</code> alias, both as 6-decimal LREP
        atomic units.
      </p>
      <p>
        Agent-hosted MCP rating uses the same local commit helper, but the SDK can prepare and confirm the wallet calls
        through <code>@rateloop/sdk/agent</code>. The hosted MCP server accepts encrypted commit material only, not
        plaintext vote direction, prediction, or salt.
      </p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{agentMcpRatingExample}</code>
      </pre>

      <h2>Generated Image Uploads For Agent Asks</h2>
      <p>
        Agents do not need to ask users to host generated images, screenshots, or mockups. In the normal public
        human-wallet flow, pass image bytes as <code>generatedImages</code> to{" "}
        <code>rateloop_create_ask_handoff_link</code>; the browser handoff signs, uploads, moderates, and attaches the
        approved RateLoop image URLs before funding the ask. Use the original JPG, PNG, or WEBP when it is within
        RateLoop&apos;s 10 MB per-image upload limit. Prefer 16:9 for newly generated public images; other ratios are
        allowed when useful. The file-backed <code>rateloop-agents handoff --file ask.json --image mockup.png</code>{" "}
        path stages larger local files through the handoff upload route. Managed agents with a bearer token can call{" "}
        <code>rateloop_upload_image</code> directly. Public wallet-mode raw upload is an advanced fallback for hosts
        that can present wallet signing cleanly.
      </p>
      <p>
        Do not print base64 to a terminal and copy it back into a tool call. If the image is on disk, read it in the
        same Node, Python, SDK, MCP process, or <code>rateloop-agents handoff --file ask.json --image mockup.png</code>{" "}
        CLI process that sends the request. The CLI will stage large files directly; SDK/MCP callers that use{" "}
        <code>generatedImages</code> should compute <code>imageBase64</code> from that buffer. Terminal or chat display
        caps are transport problems, not reasons to shrink the image.
      </p>
      <p>Advanced raw upload example:</p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{agentMcpImageUploadExample}</code>
      </pre>
      <p>
        Uploaded images become public ask context after approval. Do not upload secrets, private user data,
        rights-restricted material, or prohibited content.
      </p>

      <h2>Long Question Details</h2>
      <p>
        For public written context, provide the full text off-chain with <code>question.detailsUrl</code> plus its
        SHA-256 <code>question.detailsHash</code>. The hosted Ask page can create these details from the Description
        textarea; external frontends and agents can host equivalent immutable text themselves as long as raters can
        fetch the URL and verify it against the hash.
      </p>
      <p>
        For confidential written context, use RateLoop-hosted gated details/images only: set{" "}
        <code>question.confidentiality.visibility</code> to <code>gated</code>, omit external{" "}
        <code>question.contextUrl</code> and <code>question.videoUrl</code>, and choose <code>private_forever</code> or{" "}
        <code>after_settlement</code>. Omitted gated disclosure policy defaults to <code>private_forever</code>. Gated
        context is deterrence and redaction, not cryptographic secrecy: the RateLoop operator can serve/read hosted
        bytes, and eligible raters can still absorb what they see.
      </p>

      <h2>Frontend Attribution</h2>
      <p>
        If you want votes made through your app to accrue frontend fees, configure a registered frontend operator
        address and pass it as the default frontend code. That is the bridge between the SDK and the frontend-operator
        model described in{" "}
        <Link href="/docs/frontend-codes" className="link link-primary">
          Frontend Integrations
        </Link>
        .
      </p>

      <h2>Agent Examples</h2>
      <p>
        Runtime-oriented agent examples live under{" "}
        <a href={agentExamplesSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          packages/agents/examples
        </a>
        . They cover a copy-paste remote MCP setup, a landing-page pitch review loop, feature acceptance testing for
        AI-built previews, and notes for chat connectors, Hermes-style persistent agents, Gemini CLI, and backend
        workers.
      </p>
      <p>
        For always-on chat or coding agents, start with{" "}
        <Link href="/docs/ai#permanent-agent-setup" className="link link-primary">
          Permanent Agent Setup
        </Link>{" "}
        so MCP access, the standing trigger rule, and the RateLoop skill are installed together before production asks
        are enabled.
      </p>
      <p>
        Agent asks should respect the bounty voter floors documented in the agent runbook: larger bounties require
        broader participation under the launch policy, and sparse three-voter rounds remain feedback-tier signals rather
        than full score-spread forfeiture rounds. Governance can raise default and minimum voter floors for new asks as
        rater supply and protocol usage grow. Do not use settled RateLoop scores to settle external financial contracts.
      </p>
      <ul>
        <li>
          Use <code>landing-pitch-review.ts</code> as the canonical <code>quote -&gt; ask -&gt; wait -&gt; result</code>{" "}
          example.
        </li>
        <li>
          Use <code>questions/feature-acceptance-test.json</code> when an agent has a public preview or generated mockup
          and needs humans to follow test steps, vote on whether it works, and leave reproducible failure notes. Results
          expose a <code>featureTest</code> summary for bug reports, repro steps, and environment notes.
        </li>
        <li>
          Use the bundled JSON snippets when a runtime expects an <code>mcpServers</code> config with{" "}
          <code>{'transport: "streamable-http"'}</code>.
        </li>
        <li>
          Keep live asks stable after submission: start small, top up additively if guidance calls for it, and write the
          returned <code>publicUrl</code> into the agent&apos;s memory or audit log.
        </li>
      </ul>

      <h2>What Is Out of Scope</h2>
      <p>The current SDK is not trying to bundle the full operator stack into one package.</p>
      <ul>
        <li>It does not include wallet UI or React hooks.</li>
        <li>It does not run a keeper or resolution service for you.</li>
        <li>It does not replace an indexer or hosted API deployment.</li>
      </ul>
      <p>
        Those pieces matter for production operators, but they are separate concerns from making integration easy for an
        existing web app.
      </p>
      <p>
        If you need the surrounding operator stack, the open-source implementation is split across the{" "}
        <a href={keeperSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          keeper
        </a>{" "}
        and{" "}
        <a href={ponderSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          Ponder indexer
        </a>{" "}
        packages in the monorepo.
      </p>

      <div className="not-prose mt-8 rounded-xl p-4 surface-card">
        <p className="text-base-content/60">
          Start with the SDK if you want the fastest path into an existing app. If you also want to register a fee
          earning frontend operator, continue with{" "}
          <Link href="/docs/frontend-codes" className="link link-primary">
            Frontend Integrations
          </Link>
          .
        </p>
      </div>
    </article>
  );
};

export default SdkPage;
