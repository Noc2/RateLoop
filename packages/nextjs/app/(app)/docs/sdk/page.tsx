import Link from "next/link";
import type { NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const sdkSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/sdk";
const agentExamplesSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/agents/examples";
const referenceAppSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/nextjs";
const keeperSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/keeper";
const ponderSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/ponder";

const SdkPage: NextPage = () => {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="SDK" />
      <p className="lead text-base-content/60 text-lg">
        Use the RateLoop SDK to add hosted reads, frontend attribution, and prediction transaction helpers to an
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
          <strong>Prediction helpers</strong> for stake normalization, frontend-code resolution, tlock commit
          generation, and drand metadata binding.
        </li>
        <li>
          <strong>Wallet-agnostic output</strong> so approve and commit calls can be passed into wagmi, viem, thirdweb,
          or a custom signing flow.
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
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{`import { packVoteRoundContext } from "@rateloop/contracts";
import { createCuryoClient } from "@rateloop/sdk";
import { buildCommitPredictionParams } from "@rateloop/sdk/vote";`}</code>
      </pre>

      <h2>Quickstart</h2>
      <p>Create a client once, then use its hosted read surface wherever your app needs indexed protocol data.</p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{`const curyo = createCuryoClient({
  apiBaseUrl: "https://api.rateloop.xyz",
  frontendCode: "0x1234567890123456789012345678901234567890",
});

const stats = await curyo.read.getStats();
const { items: contentItems } = await curyo.read.searchContent({
  sortBy: "most_votes",
  limit: 12,
});

const { frontend } = await curyo.read.getFrontend(
  "0x1234567890123456789012345678901234567890",
);
const rewardStatus = await curyo.read.getRaterRewardStatus(
  "0xAgentOrRaterWallet",
);`}</code>
      </pre>

      <h2>Prediction Integration</h2>
      <p>
        For rating flows, the SDK helps you prepare the same private split-rating commit the{" "}
        <a href={referenceAppSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          reference app
        </a>{" "}
        uses. The host app still decides how to approve LREP stake and submit the commit transaction. In the redeployed
        tlock model, commit helpers thread the reveal target round and drand chain hash through the call so the
        contracts can enforce the metadata bindings on-chain.
      </p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{`const { content } = await curyo.read.getContent("42");
const epochDuration =
  content.openRound?.epochDuration ?? content.roundConfig?.epochDuration ?? 20 * 60;

const commit = await buildCommitPredictionParams({
  voter: "0xYourWalletAddress",
  chainId: 480n,
  engineAddress: "0xRoundVotingEngine",
  contentId: 42n,
  roundId: BigInt(content.openRound?.roundId ?? 1),
  opinionRating: 7.8,
  predictedCrowdRating: 7.4,
  stakeAmount: 2.5,
  epochDuration,
  roundReferenceRatingBps: content.openRound?.referenceRatingBps ?? content.ratingBps ?? 5000,
  defaultFrontendCode: curyo.config.frontendCode,
});
const roundContext = packVoteRoundContext(commit.roundId, commit.roundReferenceRatingBps);

await lrep.write.approve(["0xVotingEngine", commit.stakeWei]);
await votingEngine.write.commitVote([
  42n,
  roundContext,
  commit.targetRound,
  commit.drandChainHash,
  commit.commitHash,
  commit.ciphertext,
  commit.stakeWei,
  commit.frontend,
]);`}</code>
      </pre>

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
      <ul>
        <li>
          Use <code>landing-pitch-review.ts</code> as the canonical <code>quote -&gt; ask -&gt; wait -&gt; result</code>{" "}
          example.
        </li>
        <li>
          Use <code>questions/feature-acceptance-test.json</code> when an agent has a public preview URL and needs
          humans to follow test steps, vote on whether it works, and leave reproducible failure notes. Results expose a
          <code>featureTest</code> summary for bug reports, repro steps, and environment notes.
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
