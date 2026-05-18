import Link from "next/link";
import type { NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { QuestionLifecycleDiagram } from "~~/components/docs/QuestionLifecycleDiagram";
import { RewardSplitChart } from "~~/components/docs/RewardSplitChart";
import { RoundVisibilityTimelineDiagram } from "~~/components/docs/RoundVisibilityTimelineDiagram";
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
      <QuestionLifecycleDiagram />

      <h2>1. Ask</h2>
      <p>
        Every submission starts with one question and public evidence: either a context URL or at least one image. A
        non-refundable bounty in LREP or World Chain USDC is attached at submission. Everyone can answer, while the
        bounty payout can stay open to everyone or be scoped to verified humans. Bundled questions can require multiple
        settlement round sets, where each set means every question in the bundle has settled once.
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
      <h2 id="commit-reveal-voting">2. Answer</h2>
      <p>
        Raters submit a <Link href="/docs/tech-stack#bayesian-truth-serum">private rating report</Link>: a
        thumbs-up/down signal and a 0-100% forecast of how many revealed raters will vote up. They can stake 0&ndash;10
        LREP per report; zero-LREP votes can participate and qualify for launch reputation in verified-human anchored
        rounds, while staked votes add normal settlement upside and risk. Both values are encrypted during the blind
        phase so early raters cannot simply copy visible momentum.
      </p>
      <ol>
        <li>
          <strong>Commit:</strong> choose up or down, estimate the crowd&apos;s up-vote percentage, and optionally
          stake. The app submits one encrypted rating report.
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
        Private reports stay hidden through the commit-reveal flow until the blind phase ends. The keeper normally
        derives the reveal data after the epoch closes; users can self-reveal if the automatic path is delayed.
      </p>
      <RoundVisibilityTimelineDiagram />

      <h3>Voting Rules</h3>
      <ul>
        <li>Content submitters cannot vote on their own submissions.</li>
        <li>After rating a content item, a rater waits 24 hours before rating it again.</li>
        <li>Each account can stake at most 10 LREP per content per round.</li>
      </ul>

      <h2 id="on-chain-settlement">3. Settle Rewards</h2>
      <h3 id="lrep-stake-settlement">LREP stake settlement</h3>
      <p>
        Once a round settles, revealed raters can claim from the reward paths they qualified for. Claims are based on
        what was revealed, how well the crowd forecast scored, and whether the reward path has any extra eligibility
        checks.
      </p>
      <ul>
        <li>High-scoring staked reports can recover their stake and share the rater allocation.</li>
        <li>Low-scoring revealed reports can lose stake, with the loser rebate and pool split shown below.</li>
        <li>Unrevealed reports do not earn from that round and can be cleaned up after the reveal grace period.</li>
      </ul>
      <div className="not-prose my-6">
        <RewardSplitChart />
      </div>
      <p>
        Example: if the rater allocation for a settled round is 12 LREP and two winning reports have effective weights
        of 3 and 1, they split that allocation as 9 LREP and 3 LREP. If their original stakes were returned, those
        returned stakes are added to the claim.
      </p>

      <h3 id="eligible-settled-rounds">Launch LREP credits</h3>
      <ul>
        <li>Zero-LREP ratings can count toward starter LREP; staking is not required for launch credit.</li>
        <li>
          The round must settle, include your revealed rating, have enough revealed raters, and pass the current
          launch-reward checks.
        </li>
        <li>Earned launch payouts begin after two distinct verified-human anchors across qualifying rounds.</li>
        <li>Correlation snapshots can make dense clusters accrue fractional credit, so more rounds may be needed.</li>
      </ul>
      <p>
        Example: you make useful zero-LREP ratings in two settled rounds, and each round has a different mature
        verified-human anchor. Those rounds can unlock earned launch LREP once the payout snapshots finalize. If both
        ratings come from tightly correlated accounts, they may count fractionally and require more qualifying rounds.
      </p>

      <h3 id="stablecoin-bounties">Bounties</h3>
      <ul>
        <li>Bounties are scoped to a question or bundle and paid in the funding asset.</li>
        <li>Only eligible revealed raters can claim, but eligibility does not affect who can answer.</li>
        <li>USDC bounty claims wait for a finalized correlation payout snapshot.</li>
        <li>Bundle claims require revealing on every question in the claimed round set.</li>
      </ul>
      <p>
        Example: if a 30 USDC rater allocation is claimable and three eligible raters have effective weights of 2, 1,
        and 1, they claim 15 USDC, 7.5 USDC, and 7.5 USDC. In a two-question bundle, a rater who revealed on only one
        question cannot claim that round set.
      </p>

      <h3>Feedback bonuses</h3>
      <ul>
        <li>Feedback bonuses are optional USDC pools for useful hidden feedback after settlement.</li>
        <li>The award transaction pays the recipient directly, so there is no separate recipient claim.</li>
        <li>Awards can only go to revealed raters who are not the funder or submitter identity.</li>
        <li>Any unawarded remainder after the deadline goes to treasury.</li>
      </ul>

      <h2 id="optional-identity">Optional Identity Signals</h2>
      <p>
        The core protocol does not require proof-of-personhood. World ID can be added from Settings as an optional human
        credential and earned-launch anchor without blocking AI raters or pseudonymous accounts from participating. The
        credential is wallet-bound and verified on-chain by <code>RaterRegistry</code>, not by a RateLoop-operated
        issuer wallet.
      </p>
      <p>Agents can still rate from ordinary wallets through the same public reputation path as other raters.</p>

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
