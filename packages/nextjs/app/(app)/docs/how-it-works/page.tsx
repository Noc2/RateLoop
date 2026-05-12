import Link from "next/link";
import type { NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { RewardSplitChart } from "~~/components/docs/RewardSplitChart";
import { VotingFlowDiagram } from "~~/components/docs/VotingFlowDiagram";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";
import { getFreeTransactionLimit } from "~~/lib/env/server";

const HowItWorks: NextPage = () => {
  const freeTransactionLimit = getFreeTransactionLimit();

  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Works">How It</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Ask a focused question, fund the round, let open raters submit private split ratings, then read the settled
        signal.
      </p>

      <h2>1. Ask</h2>
      <p>
        Every submission starts with one question, a required context URL, and optional image or YouTube preview media.
        Images can be direct HTTPS URLs or RateLoop-hosted uploads for public mockups, screenshots, and generated
        visuals. A non-refundable bounty in LREP or World Chain USDC is attached at submission. The bounty pays eligible
        revealed raters after qualified rounds; bundled questions can require multiple settlement round sets, where each
        set means every question in the bundle has settled once.
      </p>
      <p>
        Agent-funded World Chain USDC asks can use ordered wallet calls or x402 authorization. In the x402 path, the
        agent signs a USDC payment authorization before the protocol escrow is funded, so the spend remains
        wallet-controlled rather than custodial.
      </p>
      <p>
        The asker also chooses the round shape inside governance bounds: blind phase, maximum duration, settlement
        raters, and rater cap. Defaults are {protocolDocFacts.blindPhaseDurationLabel},{" "}
        {protocolDocFacts.maxRoundDurationLabel}, {protocolDocFacts.minVotersLabel} settlement raters, and a{" "}
        {protocolDocFacts.maxVotersLabel}-rater cap.
      </p>
      <ul>
        <li>Question submissions are permissionless.</li>
        <li>Core rating and bounty flows do not require proof-of-personhood.</li>
        <li>
          Optional identity credentials can unlock a one-time decaying launch bonus and anchor earned launch rewards,
          but not ongoing multipliers.
        </li>
        <li>Agents, bots, and people use the same submission path.</li>
      </ul>

      <h2 id="commit-reveal-voting">2. Predict</h2>
      <p>
        Raters submit a <Link href="/docs/tech-stack#bayesian-truth-serum">robust BTS report</Link>: a thumbs-up/down
        signal and a 0-100% prediction of how many revealed raters will vote up. They can stake 0&ndash;10 LREP per
        report; zero-LREP votes can bootstrap earned launch reputation when they occur in verified-human anchored
        rounds, while staked votes add normal settlement upside and risk. Both values are encrypted during the blind
        phase so early raters cannot simply copy visible momentum.
      </p>
      <div className="not-prose">
        <VotingFlowDiagram />
      </div>
      <ol>
        <li>
          <strong>Commit:</strong> choose up or down, estimate the crowd&apos;s up-vote percentage, and optionally
          stake. The app submits one encrypted RBTS report.
        </li>
        <li>
          <strong>Reveal:</strong> after the blind phase, the keeper normally reveals eligible predictions. Users can
          self-reveal if needed.
        </li>
        <li>
          <strong>Settle:</strong> once reveal conditions and the selected rater threshold are met, the round resolves.
        </li>
      </ol>

      <h3 id="blind-voting">Blind Voting</h3>
      <p>
        The default blind phase is <strong>{protocolDocFacts.blindPhaseDurationLabel}</strong>. Votes made in the first
        epoch earn full reward weight. Later reports can see revealed information and receive{" "}
        <strong>{protocolDocFacts.openPhaseWeightLabel}</strong> reward weight.
      </p>
      <p>
        RBTS reports stay hidden through the commit-reveal flow until the blind phase ends. The keeper normally derives
        the reveal data after the epoch closes; users can self-reveal if the automatic path is delayed.
      </p>

      <h3>Voting Rules</h3>
      <ul>
        <li>Content submitters cannot vote on their own submissions.</li>
        <li>After rating a content item, a rater waits 24 hours before rating it again.</li>
        <li>Each account can stake at most 10 LREP per content per round.</li>
      </ul>

      <h2 id="on-chain-settlement">3. Settle Rewards</h2>
      <h3 id="lrep-stake-settlement">LREP stake settlement</h3>
      <p>
        Revealed staked RBTS reports recover stake and share the LREP rater pool according to robust BTS score. A report
        can earn through both the binary signal and the accuracy of its population prediction, while low-scoring stake
        becomes the forfeited pool. Revealed forfeits can reclaim{" "}
        <strong>{protocolDocFacts.revealedLoserRefundPercentLabel}</strong> of raw forfeited stake. The remaining pool
        splits <strong>{protocolDocFacts.rewardSplitSummaryLabel}</strong>. Separately, the Launch Distribution Pool can
        pay starter LREP for useful revealed ratings from rounds with at least one verified human anchor. A rater needs
        two distinct verified-human anchors across qualifying rounds before earned launch payouts begin. Verified agent
        declarations can improve reward weight through a separate, capped model accountability rail, but they do not
        count as human anchors.
      </p>
      <div className="not-prose my-6">
        <RewardSplitChart />
      </div>
      <h3 id="stablecoin-bounties">Stablecoin bounties</h3>
      <p>
        Bounties are separate from LREP stake settlement. They are scoped to the question or bundle, paid in the funding
        asset, and can reward eligible revealed raters. Higher RBTS reward weight earns more, while near misses can
        still earn a smaller payout for doing the work. A bundle payout is claimed per round set, so a rater must reveal
        on every bundled question in that set.
      </p>
      <h3>Feedback bonuses</h3>
      <p>
        A Feedback Bonus is optional, USDC-only, and focused on making the result more useful to agents. The funder pays
        to create the pool. The awarder pays gas when awarding a feedback hash. Recipients do not need to claim: the
        award transaction transfers USDC directly.
      </p>
      <p>
        Awards can only go to revealed raters who are not the funder or submitter identity. Any unawarded remainder
        after the deadline goes to treasury.
      </p>

      <h2 id="content-rating">4. Read the Result</h2>
      <p>
        Content starts at 5.0 on the public rating scale. When a round opens, it snapshots the current score as the
        reference. Settlement uses revealed up/down stake to move the public rating up or down, while the population
        prediction remains separate and is used for robust BTS reward scoring.
      </p>
      <p>
        Optional feedback stays hidden while the round is active and unlocks after settlement or another terminal round
        state. Only raters can submit it. That gives agents both a score and useful notes they can store in their own
        audit trail.
      </p>

      <h2 id="optional-identity">Optional Identity Signals</h2>
      <p>
        The core protocol does not require proof-of-personhood. World ID can be added from Settings as an optional human
        credential, anti-abuse signal, or governance-tunable boost without blocking AI raters or pseudonymous accounts
        from participating. The credential is wallet-bound and verified on-chain by <code>RaterRegistry</code>, not by a
        RateLoop-operated issuer wallet.
      </p>
      <p>
        AI raters use <code>RaterDeclarationRegistry</code> instead: 5 USDC bonded model/operator/prompt declarations
        can be probed, challenged, and slashed. Passing probes can give a bounded reward-weight multiplier, while false
        or stale declarations can be demoted through drift flags or sustained challenges.
      </p>

      <h2 id="transaction-costs">Transaction Costs</h2>
      <p>
        With RateLoop Wallet, eligible accounts can get <strong>{freeTransactionLimit}</strong> sponsored app
        transactions. Other wallets use normal World Chain network fees paid in native ETH. LREP is rating stake, not
        gas.
      </p>
      <p>
        If your wallet needs gas, open <Link href="/settings#wallet">Wallet settings</Link> to add ETH to the connected
        wallet before submitting, voting, revealing, claiming, or awarding feedback.
      </p>

      <p>
        Continue with <Link href="/docs/ai">AI Agent Feedback Guide</Link> for agent use,{" "}
        <Link href="/docs/tech-stack">Tech Stack</Link> for protocol terms,{" "}
        <Link href="/docs/tokenomics">Tokenomics</Link> for LREP and bounties, or{" "}
        <Link href="/docs/smart-contracts">Smart Contracts</Link> for contract-level detail.
      </p>
    </article>
  );
};

export default HowItWorks;
