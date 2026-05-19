import Link from "next/link";
import type { NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { QuestionLifecycleDiagram } from "~~/components/docs/QuestionLifecycleDiagram";
import { RbtsScoreSpreadSettlementDiagram } from "~~/components/docs/RbtsScoreSpreadSettlementDiagram";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";
import { getFreeTransactionLimit } from "~~/lib/env/server";

const HowItWorks: NextPage = () => {
  const freeTransactionLimit = getFreeTransactionLimit();

  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Works">How It</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Ask a focused question, fund the round, let open raters submit private ratings, then read the settled signal.
      </p>
      <QuestionLifecycleDiagram />

      <h2>1. Ask</h2>
      <p>
        Every submission starts with one question and public evidence: a context URL, at least one image, or a YouTube
        video. A non-refundable bounty in LREP or World Chain USDC is attached at submission. Everyone can answer, while
        the bounty payout can stay open to everyone or be scoped to verified humans. Bundled questions can require
        multiple settlement round sets, where each set means every question in the bundle has settled once.
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
        LREP per report; zero-LREP advisory votes can participate only in rounds that already have a staked vote and do
        not count toward settlement quorum, while staked votes add normal settlement upside and risk. Both values are
        encrypted during the blind phase so early raters cannot simply copy visible momentum.
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

      <h3>Voting Rules</h3>
      <ul>
        <li>Content submitters cannot vote on their own submissions.</li>
        <li>After rating a content item, a rater waits 24 hours before rating it again.</li>
        <li>Each account can stake at most 10 LREP per content per round.</li>
      </ul>

      <h2 id="on-chain-settlement">3. Settle Rewards</h2>
      <h3 id="lrep-stake-settlement">LREP stake settlement</h3>
      <p>
        RBTS compares every revealed staked report with the stake-weighted mean score. A report&apos;s score spread is
        its own score minus that mean.
      </p>
      <ul>
        <li>
          <code>mean = sum(stake * score) / sum(stake)</code>
        </li>
        <li>
          <code>spread = score - mean</code>
        </li>
        <li>
          Negative spreads forfeit <code>stake * intensity * abs(spread) / 100</code>.
        </li>
        <li>
          <code>voter share = forfeited pool * 96%</code>
        </li>
        <li>
          Positive spread weight is <code>stake * spread</code>, and reward is{" "}
          <code>voter share * weight / total positive weight</code>.
        </li>
        <li>
          Final claims are <code>stake + positive reward</code> for positive spreads and <code>stake - forfeiture</code>{" "}
          for negative spreads. Unrevealed reports do not earn from that round and can be cleaned up after the reveal
          grace period.
        </li>
      </ul>
      <RbtsScoreSpreadSettlementDiagram />
      <p>
        Example: Alice stakes 10 LREP and scores 93.5, Bob stakes 5 LREP and scores 90.0, and Carol stakes 5 LREP and
        scores 64.0. The stake-weighted mean is 85.25. At 1.5 intensity, Carol forfeits 1.59375 LREP; 1.53 LREP is the
        voter share. Alice claims 11.188 LREP, Bob claims 5.342 LREP, and Carol claims 3.40625 LREP.
      </p>

      <h3 id="eligible-settled-rounds">Launch LREP credits</h3>
      <p>
        To earn launch LREP, reveal useful advisory or staked ratings in eligible settled rounds; each finalized round
        adds <code>effective credit = finalized independence weight / 10,000</code>. After enough full credits and the
        verified-anchor checks are met, the payout is <code>min(cap, cap * rewarded credits / 10) - already paid</code>;
        verifying the same wallet unlocks the full earned cap, while dense correlated clusters may need more rounds
        because each credit can count fractionally.
      </p>
      <p>
        Example: you make useful advisory ratings in two eligible settled rounds, and each round has a different mature
        verified-human anchor. Those rounds can unlock earned launch LREP once the payout snapshots finalize. If both
        ratings come from tightly correlated accounts, they may count fractionally and require more qualifying rounds.
      </p>

      <h3 id="stablecoin-bounties">Bounties</h3>
      <p>
        To earn a bounty, reveal an eligible vote before the bounty closes; bundle bounties require revealing on every
        question in the claimed round set. Each qualified round pays{" "}
        <code>round allocation * claim weight / total claim weight</code>, where USDC claim weights come from the
        finalized <Link href="/docs/tech-stack#correlation-epoch-snapshots">correlation payout snapshot</Link> and
        equal-weight rounds use one unit per eligible revealed rater. An eligible commit-attributed frontend receives
        the default 3% frontend fee before rater payouts; if that frontend is not payable, the share stays with the
        rater claim.
      </p>
      <p>
        Example: if a 30 USDC rater allocation is claimable and three eligible raters have effective correlation weights
        of 2, 1, and 1, they claim 15 USDC, 7.5 USDC, and 7.5 USDC. Those weights are independence/correlation payout
        weights, not stake amounts. In a two-question bundle, a rater who revealed on only one question cannot claim
        that round set.
      </p>

      <h3>Feedback bonuses</h3>
      <p>
        To earn a feedback bonus, reveal your vote and leave useful hidden feedback; the configured awarder can pay one
        award per independent rater or feedback hash before the feedback window closes. The calculation is{" "}
        <code>recipient amount = gross award - frontend fee</code>, with the default frontend fee at 3% when an eligible
        frontend applies; unawarded remainder goes to treasury after the deadline.
      </p>

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
