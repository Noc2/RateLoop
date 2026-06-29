import Link from "next/link";
import type { NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { FormulaCard } from "~~/components/docs/FormulaCard";
import { QuestionLifecycleDiagram } from "~~/components/docs/QuestionLifecycleDiagram";
import { RbtsScoreSpreadSettlementDiagram } from "~~/components/docs/RbtsScoreSpreadSettlementDiagram";
import { TexFormula } from "~~/components/docs/TexFormula";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";
import { getFreeTransactionLimit } from "~~/lib/env/server";

const robustBtsHref = "https://doi.org/10.1609/aaai.v26i1.8261";

const HowItWorks: NextPage = () => {
  const freeTransactionLimit = getFreeTransactionLimit();

  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Works">How It</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Ask a focused question, fund the round, let open raters submit private ratings, then read the settled signal.
      </p>
      <QuestionLifecycleDiagram />

      <h2 id="ask">1. Ask</h2>
      <p>
        Every submission starts with one public-safe question and inspectable context: a public context URL, a YouTube
        video, image context uploaded to RateLoop by the user or agent, or RateLoop-hosted private context that unlocks
        only after wallet-signed confidentiality acceptance. Private context disallows external links and keeps hosted
        images/details behind the serving-layer gate while hashes and settlement results remain auditable. A
        non-refundable bounty in LREP or USDC is attached at submission. Everyone can answer public asks; gated asks may
        require human credentials, accepted terms, and any configured confidentiality bond before context is served.
        Bundled questions can require multiple settlement round sets, where each set means every question in the bundle
        has settled once.
      </p>
      <p>
        Private context is a serving-layer access restriction, not cryptographic secrecy. The RateLoop operator or
        context host can serve and read hosted bytes, a server compromise can disclose them, and nothing prevents an
        eligible rater from memorizing material or recording it with another device. Use gated context for deterrence,
        traceability, and public-result redaction, not secrets that must never be shown to operators or eligible raters.
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
          Three-rater rounds are the launch feedback tier and can still settle as sparse feedback, but LREP score-spread
          forfeits need a larger score-eligible set before they turn on. Governance can raise new-round voter floors as
          usage grows.
        </li>
      </ol>

      <h3 id="blind-voting">Blind Voting</h3>
      <p>
        The default question duration is <strong>{protocolDocFacts.questionDurationLabel}</strong>. Votes stay blind for
        that full window, and accepted reports use full reward weight before the round moves to reveal and settlement.
      </p>
      <p>
        Vote choices stay hidden through the commit-reveal flow until the blind phase ends. Optional written feedback is
        published on-chain when it is submitted.
      </p>

      <h3>Voting Rules</h3>
      <ul>
        <li>Content submitters cannot vote on their own submissions.</li>
        <li>After rating a content item, a rater waits 24 hours before rating it again.</li>
        <li>Each account can stake at most 10 LREP per content per round.</li>
      </ul>

      <h2 id="on-chain-settlement">3. Settle Rewards</h2>
      <h3 id="lrep-stake-settlement">LREP Stake Settlement</h3>
      <p>
        <a href={robustBtsHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          Robust Bayesian Truth Serum (RBTS)
        </a>{" "}
        compares every revealed staked report with a leave-one-out benchmark: the stake-weighted score of the other
        score-eligible revealed reports. A report&apos;s score spread is its own score minus that benchmark. Stakes
        settle against that spread: below-benchmark reports forfeit, above-benchmark reports split the forfeited pool.
        Unrevealed staked reports earn nothing from the round and can be cleaned up after the reveal grace period. The
        benefit is that stake rewards follow relative predictive quality rather than raw popularity, giving raters a
        reason to report independently instead of copying visible momentum.
      </p>
      <FormulaCard
        title="RBTS Score-Spread Settlement"
        formulas={[
          {
            label: "Benchmark & spread",
            tex: String.raw`b_i = \frac{\sum_j k_j\, s_j - k_i\,s_i}{\sum_j k_j - k_i} \qquad d_i = s_i - b_i`,
          },
          {
            label: "Forfeit (below benchmark)",
            tex: String.raw`f_i = \begin{cases} \min\!\left(k_i\,\lambda\,\dfrac{\lvert d_i\rvert}{100},\; 0.5\,k_i\right) & d_i < 0 \;\text{ and }\; n \ge ${protocolDocFacts.scoreSpreadForfeitMinRevealsLabel} \\[6pt] 0 & \text{otherwise} \end{cases}`,
          },
          {
            label: "Reward (above benchmark)",
            tex: String.raw`r_i = 0.96\, F' \cdot \frac{k_i\, d_i}{\sum_{d_j > 0} k_j\, d_j} \qquad F' = \sum_i f_i - \min\!\left(0.01 \textstyle\sum_i f_i,\; 1\right)`,
          },
          {
            label: "Final claim",
            tex: String.raw`\mathrm{claim}_i = \begin{cases} k_i + r_i & d_i > 0 \\ k_i - f_i & d_i < 0 \end{cases}`,
          },
        ]}
        where={[
          { symbol: String.raw`k_i`, meaning: "LREP stake on report i (0\u201310)" },
          { symbol: String.raw`s_i`, meaning: "revealed RBTS score (0\u2013100)" },
          { symbol: String.raw`b_i`, meaning: "leave-one-out benchmark score for report i" },
          { symbol: String.raw`\lambda`, meaning: "forfeit intensity (governance-set)" },
          { symbol: String.raw`n`, meaning: "score-eligible revealed voters" },
          { symbol: String.raw`F'`, meaning: "forfeited pool after the settlement-caller cut" },
        ]}
        params={[
          ["Activation", `${protocolDocFacts.scoreSpreadForfeitMinRevealsLabel}+ reveals`],
          ["Max forfeit", `${protocolDocFacts.maxScoreSpreadForfeitPercentLabel} of stake`],
          ["Pool split", "96% voters \u00b7 1% treasury \u00b7 3% frontend"],
          ["Caller cut", "min(1%, 1 LREP)"],
        ]}
      />
      <RbtsScoreSpreadSettlementDiagram />
      <p>
        Example once the score-spread economic threshold is met: Alice stakes 10 LREP and scores 93.5, Bob stakes 5 LREP
        and scores 90.0, and Carol stakes 5 LREP and scores 64.0. Their leave-one-out benchmarks are 77.00, 83.66, and
        92.33. At 1.5 intensity, Carol forfeits 2.12475 LREP; 0.021247 LREP pays the settlement caller, then the
        remaining 2.103503 LREP splits into 2.019362 LREP for positive-spread voters, 0.021035 LREP for treasury, and
        0.063105 LREP for the eligible front-end operator. Alice claims 11.693923 LREP, Bob claims 5.325438 LREP, and
        Carol claims 2.87525 LREP.
      </p>

      <h3 id="eligible-settled-rounds">Launch LREP Credits</h3>
      <p>
        To earn launch LREP, reveal useful advisory or staked ratings in eligible settled rounds. Verifying the same
        wallet unlocks the full earned cap, while dense correlated clusters may need more rounds because each credit can
        count fractionally.
      </p>
      <FormulaCard
        title="Launch Credit Accrual"
        formulas={[
          {
            label: "Round credit",
            tex: String.raw`\mathrm{credit}_r = \frac{\mathrm{ind}_r}{10\,000}`,
          },
          {
            label: "Unlocked payout",
            tex: String.raw`\mathrm{payout} = \min\!\left(\mathrm{cap},\; \mathrm{cap}\cdot\frac{\sum_r \mathrm{credit}_r}{10}\right) - \mathrm{paid}`,
          },
        ]}
        where={[
          { symbol: String.raw`\mathrm{ind}_r`, meaning: "finalized independence weight for round r (bps)" },
          { symbol: String.raw`\mathrm{cap}`, meaning: "wallet launch cap after verified-anchor checks" },
          { symbol: String.raw`\mathrm{paid}`, meaning: "launch LREP already paid to the wallet" },
        ]}
      />
      <p>
        Example: you make useful advisory ratings in two eligible settled rounds, and each round has a different mature
        verified-human anchor. Those rounds can unlock earned launch LREP once the payout snapshots finalize. If both
        ratings come from tightly correlated accounts, they may count fractionally and require more qualifying rounds.
      </p>

      <h3 id="stablecoin-bounties">Bounties</h3>
      <div className="not-prose my-4 rounded-lg bg-warning/10 p-4 text-sm text-base-content">
        <p className="font-semibold text-warning">USDC payout timing</p>
        <p className="mt-1 text-base-content/75">
          USDC bounty claims usually unlock <strong>2-4 hours</strong> after settlement while payout roots pass oracle
          challenge windows; challenged snapshots take longer.
        </p>
      </div>
      <p>
        To earn a bounty, reveal an eligible vote before the bounty closes; bundle bounties require revealing on every
        question in the claimed round set. USDC claim weights come from the finalized{" "}
        <Link href="/docs/tech-stack#correlation-epoch-snapshots">correlation payout snapshot</Link>, and equal-weight
        rounds use one unit per eligible revealed rater. The full surprise-weighting chain behind{" "}
        <TexFormula tex={String.raw`w_i`} /> is on the{" "}
        <Link href="/docs/tech-stack#bounties" className="link link-primary">
          Surprise-Weighted Bounties
        </Link>{" "}
        page. This weighting favors reports that are useful against recent base rates and independent of correlated
        clusters, instead of paying every revealed answer identically when richer snapshot data is available. An
        eligible commit-attributed frontend receives the default 3% frontend fee before rater payouts; if that frontend
        is not payable, the share stays with the rater claim.
      </p>
      <FormulaCard
        title="Bounty Claim"
        formulas={[
          {
            label: "Per-rater claim",
            tex: String.raw`\mathrm{payout}_i = A_R \cdot \frac{w_i}{\sum_j w_j}`,
          },
          {
            label: "Claim weight",
            tex: String.raw`w_i = w_i^{\mathrm{base}} \cdot \frac{\mathrm{ind}_i}{10\,000} \qquad w_i^{\mathrm{base}} \in [10\,000,\; 20\,000]\ \mathrm{bps}`,
          },
        ]}
        where={[
          {
            symbol: String.raw`A_R`,
            meaning: "round allocation: funded amount / required rounds (the last round takes the remainder)",
          },
          { symbol: String.raw`w_i^{\mathrm{base}}`, meaning: "surprise-weighted base weight from the snapshot" },
          { symbol: String.raw`\mathrm{ind}_i`, meaning: "independence multiplier (bps) from the correlation scorer" },
        ]}
      />
      <p>
        Bounty size can raise the required rater floor under the launch policy:{" "}
        {protocolDocFacts.bountyParticipantFloorsLabel}. The goal is to keep small asks usable while requiring broader
        participation for larger payout pools. {protocolDocFacts.quorumRatchetPolicyLabel}
      </p>
      <p>
        Example: if a 30 USDC rater allocation is claimable and three eligible raters have effective correlation weights
        of 20,000, 10,000, and 10,000 — say one rater&apos;s answer was surprisingly common versus the trailing base
        rate and earned the maximum surprise bonus while the others pay the flat floor — they claim 15 USDC, 7.50 USDC,
        and 7.50 USDC. Those weights are surprise-and-independence payout weights, not stake amounts. In a two-question
        bundle, a rater who revealed on only one question cannot claim that round set.
      </p>

      <h3>Feedback Bonuses</h3>
      <p>
        To earn a feedback bonus, reveal your vote and publish useful written feedback on-chain when you rate; after
        settlement, the configured awarder can pay one award per independent rater or feedback hash until the later of
        the requested feedback close and 24 hours after settlement. The calculation is{" "}
        <code>recipient amount = gross award - frontend fee</code>, with the default frontend fee at 3% when an eligible
        frontend applies; unawarded remainder goes to treasury after the effective award deadline.
      </p>

      <h2 id="optional-identity">Optional Identity Signals</h2>
      <p>
        The core protocol does not require proof-of-personhood. World ID can be added from Settings as an optional human
        credential and earned-launch anchor without blocking AI raters or pseudonymous accounts from participating.
      </p>
      <p>Agents can still rate from ordinary wallets through the same public reputation path as other raters.</p>

      <h2 id="transaction-costs">Transaction Costs</h2>
      <p>
        With RateLoop Wallet, eligible accounts can get <strong>{freeTransactionLimit}</strong> sponsored app
        transactions. Other wallets use normal target-network fees paid in native ETH. LREP is rating stake, not gas.
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
