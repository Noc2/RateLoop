import Link from "next/link";
import type { Metadata, NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { FormulaCard } from "~~/components/docs/FormulaCard";
import { SurpriseMultiplierChart } from "~~/components/docs/SurpriseMultiplierChart";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";

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
const circleBaseUsdcHref = "https://www.circle.com/multi-chain-usdc/base";
const gitcoinCocmHref =
  "https://gitcoin.co/blog/leveling-the-field-how-connection-oriented-cluster-matching-strengthens-quadratic-funding#the-solution-connection-oriented-cluster-matching-cocm";
const cocmPaperHref = "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4311507";
const surprisinglyPopularHref = "https://www.nature.com/articles/nature21054";

export const metadata = {
  title: "Tech Stack | RateLoop Docs",
  description:
    "The protocol terms behind RateLoop: EIP-3009 USDC authorization, MCP, WebMCP browser tools, World ID proof-of-human credentials, Robust Bayesian Truth Serum reports, LREP staking, and Base settlement.",
} satisfies Metadata;

const TechStackPage: NextPage = () => {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Stack">Tech</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        The landing page uses compact protocol terms. This page spells out what they mean, where RateLoop uses them, and
        why they matter for AI-funded open feedback.
      </p>

      <h2 id="x402-agent-payments">EIP-3009 USDC Authorization</h2>
      <p>
        <a href={x402IntroHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          x402
        </a>{" "}
        is an open payment standard built around HTTP <code>402 Payment Required</code>. RateLoop does not currently
        return HTTP 402 challenges, <code>PaymentRequirements</code>, or <code>X-PAYMENT</code> responses. Its live
        agent wallet lane is an EIP-3009 <code>ReceiveWithAuthorization</code> signature over USDC.
      </p>
      <p>
        Agents should prefer <code>{'paymentMode: "eip3009_usdc_authorization"'}</code>. RateLoop still accepts{" "}
        <code>{'paymentMode: "x402_authorization"'}</code> as a compatibility alias for existing integrations. The agent
        receives typed data for a USDC authorization, signs it with its wallet, and then submits the ordered transaction
        plan that funds protocol escrow. That keeps spend tied to a wallet signature while avoiding a custodial
        pre-deposit.
      </p>
      <p>
        This is a standards-based USDC authorization path, not the full x402 wire protocol. Standard x402 client
        libraries cannot auto-pay RateLoop through a 402 challenge until RateLoop adds that HTTP flow.
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
        HTTP; it is that the agent sees a stable tool interface while RateLoop handles wallet plans, EIP-3009 USDC
        authorization, budgets, callbacks, and result packaging behind those tools.
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
        In RateLoop, WebMCP is a narrow browser-handoff helper. It can tell agents which values are missing, validate
        draft asks, and explain the next user approval step. It does not replace the public MCP endpoint used by
        headless agents.
      </p>
      <p>
        Wallet-sensitive actions stay explicit. Browser signing remains a user approval step for injected wallets and
        Ledger, local signer CLI flows remain available for agents with encrypted keystores, and raw ordered wallet
        calls or EIP-3009 USDC authorization remain available for wallet-capable agents.
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
        many revealed raters will vote up. The binary signal closes the public verdict while the peer prediction
        produces an RBTS scoreBps used for competitive score-spread settlement. A finalized RBTS settlement snapshot
        supplies effective reward weights before LREP rewards become claimable, capping detected clusters before the
        score-spread math runs. This keeps reporting to one blind round while making reward readiness wait for the
        challengeable correlation root.
      </p>

      <h2 id="lrep-staking">LREP Staking</h2>
      <p>
        LREP is the optional reputation stake used in rating and the governance token used for protocol control. Raters
        submit a binary RBTS report: thumbs up/down plus the expected percentage of up votes. They can stake 0-10 LREP
        on that report; staked reports above their leave-one-out benchmark recover full stake and share forfeited
        negative-spread stake, while below-benchmark reports can forfeit and unrevealed staked reports can forfeit.{" "}
        {protocolDocFacts.scoreSpreadForfeitPolicyLabel}
      </p>
      <p>
        The reason to use staking is incentive alignment: a rater can put scarce reputation behind a prediction for
        normal settlement upside and downside. New raters can still begin through zero-LREP advisory ratings in rounds
        that already have a staked vote; they do not count toward settlement quorum, but eligible settled advisory
        rounds can qualify for launch credits.
      </p>

      <h2 id="bounties">Surprise-Weighted Bounties</h2>
      <p>
        Bounties are attached when an asker submits a question. They are separate from LREP stake settlement and can be
        funded in LREP or USDC. Eligible revealed raters claim them after qualified rounds, so useful prediction work
        can be paid even when the rating outcome is contested.
      </p>
      <p>
        Equal-weight bounty rounds give one claim-weight unit to each eligible revealed rater. USDC bounty rounds can
        instead use the finalized correlation payout snapshot, where the claim weight is the rater&apos;s effective
        correlation weight built from a surprise-weighted base claim weight. Bounty size can raise the required rater
        floor under the launch policy: {protocolDocFacts.bountyParticipantFloorsLabel}.{" "}
        {protocolDocFacts.quorumRatchetPolicyLabel} With the current oracle default, USDC bounty claims have a{" "}
        <strong>{protocolDocFacts.usdcBountyPayoutMinimumDelayLabel}</strong> minimum delay after the public verdict
        closes when the correlation epoch is already finalized, or about{" "}
        <strong>{protocolDocFacts.usdcBountyPayoutHappyPathMaxDelayLabel}</strong> on the normal happy path when both
        oracle layers still need to finalize. Challenges, missing-proposer recovery, or governed snapshot recovery are
        exceptional paths and can take longer; they do not change the normal claim timing.
      </p>
      <p>
        For USDC bounty snapshot rounds, the base claim weight is surprise-weighted: an answer that merely matches the
        prior pays the flat floor, while an answer that predicts peers better than the trailing base rate can earn extra
        weight. That bonus is reduced when an overrepresented side lacks verified or high-independence anchor support,
        capped per detected same-side cluster, and then multiplied by independence; launch-credit weights stay flat. The
        resulting claim weights split the bounty: a 30 USDC rater allocation across effective weights of 20,000, 10,000,
        and 10,000 pays 15 USDC, 7.5 USDC, and 7.5 USDC. All arithmetic is integer math in basis points with floor
        division, recomputable from on-chain events by any challenger.
      </p>
      <FormulaCard
        title="Surprise-Weighted Claim Weights"
        formulas={[
          {
            label: "Per-rater claim",
            tex: String.raw`\mathrm{payout}_i = A_R \cdot \frac{w_i}{\sum_j w_j}`,
          },
          {
            label: "Claim weight",
            tex: String.raw`w_i = \mathrm{clusterBudget}_{c,s}\!\left(b_i\right)\cdot\frac{\mathrm{ind}_i}{10\,000}`,
          },
          {
            label: "Anchored base weight",
            tex: String.raw`b_i = 10\,000 + \mathrm{anchor}_{s}\cdot\mathrm{ind}_i\cdot\frac{\sigma_i - 10\,000}{10^8}`,
          },
          {
            label: "Surprise multiplier",
            tex: String.raw`\sigma_i = \mathrm{clamp}\!\left(\frac{a_i}{p(\mathrm{side}_i)}\cdot 10\,000,\; 10\,000,\; 30\,000\right)`,
          },
          {
            label: "Agreement & prior",
            tex: String.raw`a_i = \frac{W_{\mathrm{side}(i)} - v_i}{W_{\mathrm{total}} - v_i} \qquad p(\mathrm{up}) = \mathrm{clamp}\!\left(\mathrm{upShare}_{100},\; 5\%,\; 95\%\right)`,
          },
        ]}
        where={[
          {
            symbol: String.raw`A_R`,
            meaning: "round allocation: funded amount / required rounds (the last round takes the remainder)",
          },
          {
            symbol: String.raw`\sigma_i`,
            meaning: "surprise multiplier; neutral (10\u202f000) below 8 eligible reveals",
          },
          {
            symbol: String.raw`\mathrm{clusterBudget}`,
            meaning: "same-side detected-cluster cap on aggregate surprise bonus",
          },
          {
            symbol: String.raw`\mathrm{anchor}_{s}`,
            meaning: "side-level verified/high-independence anchor factor (bps)",
          },
          { symbol: String.raw`\mathrm{ind}_i`, meaning: "independence multiplier (bps) from the correlation scorer" },
          { symbol: String.raw`a_i`, meaning: "share of other raters' reveal weight on your side" },
          { symbol: String.raw`v_i`, meaning: "your epoch-weighted reveal weight" },
          { symbol: String.raw`p`, meaning: "clamped trailing up-vote share over the base-rate window" },
        ]}
        params={[
          ["Surprise cap", "3.0x"],
          ["Base-rate window", "100 rounds"],
          ["Neutral below", "8 reveals"],
          ["Base weight range", "10\u202f000\u201320\u202f000 bps"],
        ]}
      />
      <p>
        Defaults come from the normative spec (scorer rateloop-correlation-epoch-v4); parameters and pinned input
        snapshot references are committed via the snapshot parameterHash.
      </p>
      <SurpriseMultiplierChart />
      <p>
        The weighting comes from the peer-prediction literature.{" "}
        <a href={btsHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          Prelec&apos;s Bayesian Truth Serum
        </a>{" "}
        rewards answers that are &quot;surprisingly common&quot; relative to what raters predicted, and the{" "}
        <a href={surprisinglyPopularHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          surprisingly popular criterion of Prelec, Seung, and McCoy
        </a>{" "}
        shows that answers more popular than the crowd expected carry outsized information. Surprise-weighted bounties
        apply the same principle to payouts: revealed reports that beat the prior earn a larger bounty share than
        reports that merely echo it. The benefit is a payout rule that buys scarce, informative judgment instead of
        rewarding only participation or raw majority alignment.
      </p>

      <h2 id="correlation-epoch-snapshots">Correlation Epoch Snapshots</h2>
      <p>
        RateLoop uses challengeable correlation snapshots for RBTS stake settlement, payout accounting, and
        public-rating effective weights. Settlement records the public verdict and any pending raw rating evidence
        first; then RBTS stake rewards, the visible rating evidence update, USDC bounty claims, and earned launch LREP
        credits wait for the matching finalized Merkle roots. This delays reward finality and visible rating movement
        until the relevant snapshot has cleared its challenge window.
      </p>
      <p>
        Effective correlation weight is the payout weight left after applying an independence multiplier to the
        surprise-weighted base claim weight described under{" "}
        <a href="#bounties" className="link link-primary">
          Surprise-Weighted Bounties
        </a>
        . It answers &quot;how much independent payout credit should this revealed rater receive?&quot; rather than
        &quot;how much LREP did this rater stake?&quot; For example, a fully independent rater may keep 10,000
        independence bps, while two tightly correlated raters may each be capped to a fractional weight.
      </p>
      <p>
        The scorer is inspired by{" "}
        <a href={gitcoinCocmHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          Connection-Oriented Cluster Matching (COCM)
        </a>
        : it compresses dense wallet clusters, timing/funding links, agent operator links, and repeated cross-round
        behavior into an independence multiplier. Verified humans still go through the scorer; verification is a strong
        uniqueness anchor, not proof that two accounts are behaviorally independent.
      </p>
      <p>
        Correlation artifacts use the <code>rateloop-correlation-artifact-v3</code> shape. Ponder snapshots each scoring
        input at the round settlement event, or at the pending launch-credit event, including historical vote count,
        verified-human status, credential reference, active ban reasons, and the source block/transaction/log pointer.
        The epoch parameter hash commits to those input snapshot references, so two honest operators recomputing the
        same finalized round use the same boundary instead of whatever identity state exists later.
      </p>
      <p>
        Any keeper or indexer can recompute the same artifact. Registered frontend operators backed by a 1,000 LREP bond
        can propose the correlation epoch and round payout roots directly or through a delegated snapshot keeper that
        the frontend assigned, while other operators or auditors can challenge a bad root during the window and finalize
        the snapshot on-chain after the window passes. Once an escrow or launch consumer has consumed a finalized payout
        root, the oracle no longer permits governance to reject that consumed root. Unverified raters can still earn,
        but low independence means each round contributes fractional launch credit, so several independent rounds may be
        needed before LREP starts paying.
      </p>

      <h2 id="feedback-bonuses">Feedback Bonuses</h2>
      <p>
        Feedback Bonuses are optional LREP or USDC pools for useful rater notes. Written feedback is published on-chain
        by the rater when it is submitted, while the vote choice and crowd-share prediction stay hidden through the
        blind voting flow. Awarders get at least 24 hours after settlement to pay selected feedback from revealed
        independent raters, which gives agents more than a score: they get rationale that can go into an audit trail.
      </p>

      <h2 id="on-chain-settlement">On-Chain Settlement</h2>
      <p>
        Questions, prediction commitments, reveals, reward accounting, bounty claims, and governance settings settle
        through smart contracts. Off-chain services and indexed APIs make the data easier to read, but the protocol
        state is auditable from the chain.
      </p>

      <h2 id="usdc-stablecoins">USDC And Stablecoins</h2>
      <p>
        RateLoop uses USDC for agent-friendly EIP-3009 authorization and one-shot USDC bounty plus Feedback Bonus
        funding. LREP remains available for bounty and Feedback Bonus funding through wallet-call paths. Circle lists
        USDC on Base as native ERC-20 USDC, and Base keeps the payment path EVM-compatible and low-cost for small
        human-feedback jobs.
      </p>

      <h2>Research References</h2>
      <ul>
        <li>
          x402 background and future wire-flow references: <a href={x402IntroHref}>overview</a>,{" "}
          <a href={x402Http402Href}>HTTP 402</a>, <a href={x402NetworkSupportHref}>network and token support</a>,{" "}
          <a href={x402McpHref}>MCP integration</a>
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
          Surprise weighting: <a href={surprisinglyPopularHref}>Prelec, Seung, and McCoy surprisingly popular paper</a>
        </li>
        <li>
          Correlation caps: <a href={gitcoinCocmHref}>Gitcoin COCM overview</a>,{" "}
          <a href={cocmPaperHref}>Connection-Oriented Cluster Matching paper</a>
        </li>
        <li>
          Circle: <a href={circleBaseUsdcHref}>USDC on Base</a>
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
