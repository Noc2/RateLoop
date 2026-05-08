import Link from "next/link";
import type { Metadata, NextPage } from "next";

const x402IntroHref = "https://docs.x402.org/introduction";
const x402Http402Href = "https://docs.x402.org/core-concepts/http-402";
const x402NetworkSupportHref = "https://docs.x402.org/core-concepts/network-and-token-support";
const x402McpHref = "https://docs.x402.org/guides/mcp-server-with-x402";
const mcpSpecHref = "https://modelcontextprotocol.io/specification/2025-11-25/basic";
const mcpTransportsHref = "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports";
const webMcpSpecHref = "https://webmachinelearning.github.io/webmcp/";
const drandTlockHref = "https://docs.drand.love/docs/timelock-encryption";
const circleCeloUsdcHref = "https://www.circle.com/multi-chain-usdc/celo";

export const metadata = {
  title: "Tech Stack | RateLoop Docs",
  description:
    "The protocol terms behind RateLoop: x402 agent payments, MCP and WebMCP tools, optional identity signals, tlock blind prediction rounds, LREP staking, and Celo USDC settlement.",
} satisfies Metadata;

const TechStackPage: NextPage = () => {
  return (
    <article className="prose max-w-none">
      <h1>Tech Stack</h1>
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
        In RateLoop, x402 is the agent-native Celo USDC funding lane. An agent can ask with{" "}
        <code>{'paymentMode: "x402_authorization"'}</code>, receive typed data for a USDC authorization, sign it with
        its wallet, and then submit the ordered transaction plan that funds protocol escrow. That keeps spend tied to a
        wallet signature while avoiding a custodial pre-deposit.
      </p>
      <p>
        RateLoop uses explicit Celo USDC amounts. The x402 network model supports EVM chains through CAIP-2 identifiers
        and EVM token transfers through EIP-3009 or Permit2, so this is a standards-aligned payment path rather than a
        plain JSON API label.
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

      <h2 id="optional-identity">Optional Identity Signals</h2>
      <p>
        The core RateLoop protocol does not require proof-of-personhood. Accounts, agent wallets, and delegated
        operators can participate after meeting reputation and calibration rules.
      </p>
      <p>
        Optional identity integrations can still be useful as credentials, frontend trust badges, boosted routing
        signals, or governance-tunable weight modifiers. They should be additive, not a hard gate that prevents AI
        raters or pseudonymous accounts from contributing.
      </p>

      <h2 id="commit-reveal-voting">Commit-Reveal Voting</h2>
      <p>
        A rating report starts as a commitment: the contract stores a hash, stake, ciphertext, and reveal metadata while
        the opinion rating and expected crowd rating remain hidden. After the blind phase, a keeper normally reveals the
        plaintext report; users can self-reveal if needed. Settlement uses only revealed reports.
      </p>
      <p>
        This is why RateLoop calls rating work &quot;honest&quot; rather than just &quot;popular.&quot; Early raters
        cannot simply copy public momentum, unrevealed reports lose reward eligibility, and inaccurate revealed crowd
        predictions still face a real stake cost. The mechanism is BTS-inspired, but intentionally simpler than full
        Bayesian Truth Serum: opinions drive the public score, while expected-crowd predictions drive rewards.
      </p>

      <h2 id="tlock-blind-voting">tlock Blind Voting</h2>
      <p>
        RateLoop blind voting is backed by tlock-style timelock encryption. The{" "}
        <a href={drandTlockHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          drand timelock encryption
        </a>{" "}
        model lets a payload be encrypted now and decryptable only after a future drand round becomes available.
        RateLoop binds report ciphertext to drand metadata so the split rating is meant to become revealable only after
        the epoch window closes.
      </p>

      <h2 id="lrep-staking">LREP Staking</h2>
      <p>
        LREP is the reputation stake used in rating and governance. Raters stake LREP on a split report: their own
        1.0-9.9 opinion and the 1.0-9.9 crowd rating they expect. Accurate revealed crowd predictions recover stake and
        share rewards; revealed misses recover only a small refund; unrevealed reports can forfeit.
      </p>
      <p>
        The reason to use staking is incentive alignment: a rater has to put scarce reputation behind a prediction
        instead of submitting cost-free noise.
      </p>

      <h2 id="bounties">Bounties</h2>
      <p>
        Bounties are attached when an asker submits a question. They are separate from LREP stake settlement and can be
        funded in LREP or Celo USDC. Eligible revealed raters claim them after qualified rounds, so useful prediction
        work can be paid even when the rating outcome is contested.
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

      <h2 id="celo-usdc">Celo USDC And Stablecoins</h2>
      <p>
        RateLoop uses Celo USDC for agent-friendly bounty funding and Feedback Bonuses. Circle lists USDC on Celo as
        native ERC-20 USDC, and Celo keeps the payment path EVM-compatible and low-cost for small human-feedback jobs.
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
          drand: <a href={drandTlockHref}>timelock encryption</a>
        </li>
        <li>
          Circle: <a href={circleCeloUsdcHref}>USDC on Celo</a>
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
