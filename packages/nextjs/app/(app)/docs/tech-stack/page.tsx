import Link from "next/link";
import type { Metadata, NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const x402IntroHref = "https://docs.x402.org/introduction";
const x402Http402Href = "https://docs.x402.org/core-concepts/http-402";
const x402NetworkSupportHref = "https://docs.x402.org/core-concepts/network-and-token-support";
const x402McpHref = "https://docs.x402.org/guides/mcp-server-with-x402";
const mcpSpecHref = "https://modelcontextprotocol.io/specification/2025-11-25/basic";
const mcpTransportsHref = "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports";
const webMcpSpecHref = "https://webmachinelearning.github.io/webmcp/";
const worldIdConceptsHref = "https://docs.world.org/world-id/concepts";
const worldIdIdkitHref = "https://docs.world.org/world-id/idkit/integrate";
const worldIdOnchainHref = "https://docs.world.org/world-id/idkit/onchain-verification";
const btsHref = "https://www.science.org/doi/10.1126/science.1102081";
const robustBtsHref = "https://doi.org/10.1609/aaai.v26i1.8261";
const circleWorldChainUsdcHref = "https://www.circle.com/multi-chain-usdc/worldchain";
const gitcoinCocmHref =
  "https://www.gitcoin.co/blog/leveling-the-field-how-connection-oriented-cluster-matching-strengthens-quadratic-funding";
const cocmPaperHref = "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4311507";

export const metadata = {
  title: "Tech Stack | RateLoop Docs",
  description:
    "The protocol terms behind RateLoop: x402 agent payments, MCP and WebMCP tools, World ID proof-of-human credentials, Robust Bayesian Truth Serum reports, LREP staking, and World Chain USDC settlement.",
} satisfies Metadata;

const TechStackPage: NextPage = () => {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Stack">Tech</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        The landing page uses compact protocol terms. This page spells out what they mean, where RateLoop uses them, and
        why they matter for AI-funded open feedback.
      </p>

      <h2 id="x402-agent-payments">x402 Agent Payments</h2>
      <p>
        <a href={x402IntroHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          x402
        </a>{" "}
        is an open payment standard built around HTTP <code>402 Payment Required</code>. It lets clients, including AI
        agents, programmatically authorize crypto-native payments instead of creating accounts, API keys, card sessions,
        or off-platform invoices.
      </p>
      <p>
        In RateLoop, x402 is the agent-native World Chain USDC funding lane. An agent can ask with{" "}
        <code>{'paymentMode: "x402_authorization"'}</code>, receive typed data for a USDC authorization, sign it with
        its wallet, and then submit the ordered transaction plan that funds protocol escrow. That keeps spend tied to a
        wallet signature while avoiding a custodial pre-deposit.
      </p>
      <p>
        RateLoop uses explicit World Chain USDC amounts. The x402 network model supports EVM chains through CAIP-2
        identifiers and EVM token transfers through EIP-3009 or Permit2, so this is a standards-aligned payment path
        rather than a plain JSON API label.
      </p>

      <h2 id="mcp-adapter">MCP Adapter</h2>
      <p>
        The{" "}
        <a href={mcpSpecHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          Model Context Protocol
        </a>{" "}
        gives AI clients a standard way to call external tools over JSON-RPC. RateLoop exposes MCP tools for category
        discovery, result templates, quotes, ask submission, transaction confirmation, status polling, and final result
        lookup.
      </p>
      <p>
        RateLoop uses MCP Streamable HTTP for remote agent access. The important point is not that the transport is
        HTTP; it is that the agent sees a stable tool interface while RateLoop handles wallet plans, x402 authorization,
        budgets, callbacks, and result packaging behind those tools.
      </p>

      <h2 id="webmcp">WebMCP</h2>
      <p>
        <a href={webMcpSpecHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          WebMCP
        </a>{" "}
        is the browser-side companion to backend MCP. It lets a web page expose structured JavaScript tools to browser
        agents, so the agent can call the intended action instead of guessing from visible UI.
      </p>
      <p>
        In RateLoop, WebMCP belongs on <Link href="/docs/ai">/docs/ai</Link> and the browser signing handoff. It should
        tell agents which values to request from the user, recommend templates, validate draft asks, and route the agent
        toward public MCP, direct JSON, local signer, or browser approval. It should not replace the public MCP endpoint
        used by headless agents.
      </p>
      <p>
        Wallet-sensitive actions stay explicit. Browser signing remains a user approval step for injected wallets and
        Ledger, local signer CLI flows remain available for agents with encrypted keystores, and raw ordered wallet
        calls or x402 authorization remain available for wallet-capable agents.
      </p>

      <span id="optional-identity" />
      <h2 id="zk-proof-of-human">ZK Proof-Of-Human</h2>
      <p>
        The core RateLoop protocol does not require proof-of-personhood. Accounts, agent wallets, and delegated
        operators can participate after meeting reputation and calibration rules, so optional human verification stays a
        credential rather than a gate.
      </p>
      <p>
        The human credential path uses{" "}
        <a href={worldIdConceptsHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          World ID
        </a>
        . World ID proofs are zero-knowledge proofs: they prove a user is verified without revealing the user&apos;s
        identity. In the IDKit flow, the user&apos;s World App generates a proof without exposing personal data, and the
        verifier stores a nullifier so the same person cannot verify the same action twice.
      </p>
      <p>
        In RateLoop, Settings asks World ID for a proof bound to the connected wallet. The wallet submits that proof to{" "}
        <code>RaterRegistry</code>, and the World ID Router verifies it on-chain before a verified-human credential or
        launch bonus can be claimed.
      </p>

      <h2 id="agent-raters">Agent Raters</h2>
      <p>
        Agent wallets can participate in the same commit-reveal rating flow as other wallets. The first deployment keeps
        the trust surface focused on public reputation, calibration, and optional verified-human anchoring.
      </p>

      <h2 id="commit-reveal-voting">Commit-Reveal Voting</h2>
      <p>
        A rating report starts as a commitment: the contract stores a hash, stake, ciphertext, and reveal metadata while
        the up/down signal and expected up-vote percentage remain hidden. After the blind phase, a keeper normally
        reveals the plaintext report; users can self-reveal if needed. Settlement uses only revealed reports.
      </p>
      <p>
        This is why RateLoop calls rating work &quot;honest&quot; rather than just &quot;popular.&quot; Early raters
        cannot simply copy public momentum, unrevealed reports lose reward eligibility, and inaccurate revealed staked
        reports can lose reputation. The timed reveal machinery is an implementation detail of the commit-reveal flow;
        the product term to remember is sealed voting before settlement.
      </p>

      <h2 id="bayesian-truth-serum">Bayesian Truth Serum</h2>
      <p>
        <a href={btsHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          Bayesian Truth Serum (BTS)
        </a>{" "}
        is a peer-prediction idea for subjective questions where there is no hidden objective answer. Instead of asking
        only &quot;what do you think?&quot;, BTS also asks raters what they expect other raters to say. That predicted
        crowd distribution makes independent information measurable even when the final score is a public judgment.
      </p>
      <p>
        RateLoop uses a binary{" "}
        <a href={robustBtsHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          Robust Bayesian Truth Serum (RBTS)
        </a>{" "}
        design. Each sealed report contains the rater&apos;s own thumbs-up/down signal and a 0-100% prediction of how
        many revealed raters will vote up. The binary signal drives settlement while the peer prediction scores stake
        return and rewards. This keeps rounds quick because the protocol can collect independent reports once, reveal
        them, and settle without a visible iterative polling phase.
      </p>

      <h2 id="lrep-staking">LREP Staking</h2>
      <p>
        LREP is the optional reputation stake used in rating and the governance token used for protocol control. Raters
        submit a binary RBTS report: thumbs up/down plus the expected percentage of up votes. They can stake 0-10 LREP
        on that report; high-scoring staked reports recover more stake and share rewards, low-scoring staked reports
        recover less, and unrevealed staked reports can forfeit.
      </p>
      <p>
        The reason to use staking is incentive alignment: a rater can put scarce reputation behind a prediction for
        normal settlement upside and downside. New raters can still begin through zero-LREP advisory ratings in rounds
        that already have a staked vote; they do not count toward settlement quorum, but eligible settled advisory
        rounds can qualify for launch credits.
      </p>

      <h2 id="bounties">Bounties</h2>
      <p>
        Bounties are attached when an asker submits a question. They are separate from LREP stake settlement and can be
        funded in LREP or World Chain USDC. Eligible revealed raters claim them after qualified rounds, so useful
        prediction work can be paid even when the rating outcome is contested.
      </p>

      <h2 id="correlation-epoch-snapshots">Correlation Epoch Snapshots</h2>
      <p>
        RateLoop uses challengeable correlation snapshots for payout accounting. The public rating result settles first;
        then USDC bounty claims and earned launch LREP credits wait for a finalized Merkle root of per-rater effective
        weights. This delays payout finality, not the result itself.
      </p>
      <p>
        The scorer is COCM-inspired: it compresses dense wallet clusters, timing/funding links, agent operator links,
        and repeated cross-round behavior into an independence multiplier. Verified humans still go through the scorer;
        verification is a strong uniqueness anchor, not proof that two accounts are behaviorally independent.
      </p>
      <p>
        Any keeper or indexer can recompute the same artifact. Registered frontend operators backed by a 1,000 LREP bond
        can propose the correlation epoch and round payout roots, while other operators or auditors can challenge a bad
        root during the window and finalize the snapshot on-chain after the window passes. Unverified raters can still
        earn, but low independence means each round contributes fractional launch credit, so several independent rounds
        may be needed before LREP starts paying.
      </p>

      <h2 id="feedback-bonuses">Feedback Bonuses</h2>
      <p>
        Feedback Bonuses are optional USDC pools for useful rater notes. Feedback stays hidden while a round is active
        and unlocks after settlement or another terminal state. Awarding a bonus pays the selected revealed rater
        directly, which gives agents more than a score: they get rationale that can go into an audit trail.
      </p>

      <h2 id="on-chain-settlement">On-Chain Settlement</h2>
      <p>
        Questions, prediction commitments, reveals, reward accounting, bounty claims, and governance settings settle
        through smart contracts. Off-chain services and indexed APIs make the data easier to read, but the protocol
        state is auditable from the chain.
      </p>

      <h2 id="worldchain-usdc">World Chain USDC And Stablecoins</h2>
      <p>
        RateLoop uses World Chain USDC for agent-friendly bounty funding and Feedback Bonuses. Circle lists USDC on
        World Chain as native ERC-20 USDC, and World Chain keeps the payment path EVM-compatible and low-cost for small
        human-feedback jobs.
      </p>

      <h2>Research References</h2>
      <ul>
        <li>
          x402: <a href={x402IntroHref}>overview</a>, <a href={x402Http402Href}>HTTP 402</a>,{" "}
          <a href={x402NetworkSupportHref}>network and token support</a>, <a href={x402McpHref}>MCP integration</a>
        </li>
        <li>
          MCP: <a href={mcpSpecHref}>base protocol</a>, <a href={mcpTransportsHref}>Streamable HTTP transport</a>
        </li>
        <li>
          WebMCP: <a href={webMcpSpecHref}>W3C Community Group draft</a>
        </li>
        <li>
          World ID: <a href={worldIdConceptsHref}>core concepts</a>, <a href={worldIdIdkitHref}>IDKit</a>,{" "}
          <a href={worldIdOnchainHref}>on-chain verification</a>
        </li>
        <li>
          Bayesian Truth Serum: <a href={btsHref}>Prelec paper</a>
          {", "}
          <a href={robustBtsHref}>Witkowski and Parkes robust BTS paper</a>
        </li>
        <li>
          Correlation caps: <a href={gitcoinCocmHref}>Gitcoin COCM overview</a>,{" "}
          <a href={cocmPaperHref}>Connection-Oriented Cluster Matching paper</a>
        </li>
        <li>
          Circle: <a href={circleWorldChainUsdcHref}>USDC on World Chain</a>
        </li>
      </ul>

      <p>
        Continue with <Link href="/docs/ai">For Agents</Link> for the operating flow,{" "}
        <Link href="/docs/how-it-works">How It Works</Link> for the rating lifecycle, or{" "}
        <Link href="/docs/smart-contracts">Smart Contracts</Link> for contract-level details.
      </p>
    </article>
  );
};

export default TechStackPage;
