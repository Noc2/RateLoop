import { DocsTitle } from "~~/components/docs/DocsTitle";
import { TokenAllocationChart } from "~~/components/docs/TokenAllocationChart";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";
import {
  LREP_MAX_SUPPLY_LABEL,
  launchDistributionBreakdownRows,
  tokenDistributionTableRows,
} from "~~/lib/docs/tokenomics";

const Tokenomics = () => {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Tokenomics" />
      <p className="lead text-base-content/60 text-lg">
        Loop Reputation (LREP) token distribution, question funding, and reward mechanics.
      </p>

      <h2>Overview</h2>
      <p>
        Loop Reputation (LREP) is a capped, transferable reputation and governance token. It has no protocol token sale
        and no treasury backing; supply is distributed through protocol-controlled pools, earned protocol rewards, and
        governance-approved programs.
      </p>

      <h2>Token Overview</h2>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <tbody>
            <tr>
              <td className="font-medium">Name</td>
              <td>Loop Reputation</td>
            </tr>
            <tr>
              <td className="font-medium">Symbol</td>
              <td>LREP</td>
            </tr>
            <tr>
              <td className="font-medium">Max Supply</td>
              <td>{LREP_MAX_SUPPLY_LABEL}</td>
            </tr>
            <tr>
              <td className="font-medium">Decimals</td>
              <td>6</td>
            </tr>
            <tr>
              <td className="font-medium">Type</td>
              <td>Transferable reputation and governance token</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Supply is fixed at <strong>100 million LREP</strong>. The full supply is minted at launch into
        protocol-controlled pools, with no team allocation or token sale.
      </p>
      <p>
        Transferable LREP is intentional because the protocol needs portable ownership and reputation, but token balance
        is only one input. RBTS score, effective-unit scoring, verified-human launch anchors, calibration, reveal
        reliability, governance locks, and hard floors on proposal thresholds, submission bounties, and AI declaration
        bonds limit the damage from bought or rented balance.
      </p>

      <hr />

      <h2>Token Distribution</h2>
      <div className="not-prose my-6">
        <TokenAllocationChart />
      </div>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Pool</th>
              <th>Allocation</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {tokenDistributionTableRows.map(row => (
              <tr key={row.label}>
                <td className="font-medium">{row.label}</td>
                <td className="font-mono">{row.amountLabel}</td>
                <td>{row.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Launch Distribution Pool</h3>
      <p>
        The 64M LREP Launch Distribution Pool is the protocol&apos;s onboarding engine. It is not a large airdrop to the
        previous user set. The split is <strong>35M LREP</strong> for verified + referral rewards,{" "}
        <strong>25M LREP</strong> for earned rater rewards, and <strong>4M LREP</strong> for legacy users.
      </p>
      <p>
        The 4M legacy claim is split across the same nine migrated verified users from the old redeploy manifest.
        Allocation is proportional to old claimant amount plus old referrer rewards earned, so claimant-side referral
        bonuses and the recorded referrer bonus are both preserved in the fixed legacy rail.
      </p>
      <p>
        New users can start with a zero-LREP prediction path and earn initial launch reputation when their ratings are
        useful. Staking LREP remains available for raters who want normal winner/loser settlement upside and downside,
        but owning LREP is not intended to be the first barrier to participation.
      </p>
      <p>
        Earned rater rewards are open to any rater, including agents, but the launch pool only counts ratings from
        verified-human anchored rounds. The initial policy requires three revealed raters, one verified human in the
        round, and two distinct verified-human anchors across a rater&apos;s qualifying history before payouts begin.
        Caps start at <strong>10 LREP</strong> and step down through 5, 2.5, 1.25, and 0.5 LREP so the 25M LREP earned
        rater rail can support about 12.6M fully paid recipients. Governance can tighten these thresholds over time. AI
        declarations, including verified agent declarations, do not count as human anchors and do not qualify for the
        one-time verified bonus.
      </p>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Launch rail</th>
              <th>Allocation</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {launchDistributionBreakdownRows.map(([rail, amount, purpose]) => (
              <tr key={rail}>
                <td className="font-medium">{rail}</td>
                <td className="font-mono">{amount}</td>
                <td>{purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Rail</th>
              <th>Eligibility</th>
              <th>Distribution</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Earned rater rewards</td>
              <td>Accounts that complete qualifying revealed ratings in verified-human anchored rounds</td>
              <td className="font-mono">Count-based, decaying cohorts</td>
              <td>Starts with one verified human per round and two distinct anchors before payout</td>
            </tr>
            <tr>
              <td>Verified bonus</td>
              <td>One optional uniqueness credential per person</td>
              <td className="font-mono">One-time decaying bonus</td>
              <td>Human uniqueness only; AI model declarations are handled by a separate reward-weight rail</td>
            </tr>
            <tr>
              <td>Referrals</td>
              <td>Valid referrer and referred rater activity</td>
              <td className="font-mono">Small bounded bonus</td>
              <td>Designed to reward real onboarding, not passive invite farming</td>
            </tr>
            <tr>
              <td>Legacy claim</td>
              <td>The small set of previous protocol users</td>
              <td className="font-mono">Fixed allocation</td>
              <td>Recognizes early history without consuming the launch pool&apos;s growth budget</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Verification acceleration, safety responses, appeals, and governance programs are treasury responsibilities.
        They do not draw from the Launch Distribution Pool. The previous 12M Bootstrap Pool allocation is folded into
        launch distribution: 10M LREP moved to verified + referral rewards, and 2M LREP moved to legacy users. The
        Consensus Subsidy Reserve keeps its separate purpose: supporting high-agreement rounds with little losing stake.
      </p>

      <h3 id="bounties">Bounties</h3>
      <p>
        Bounties are separate from LREP launch rewards. They are attached at submission, funded in LREP or World Chain
        USDC, scoped to one question or a question bundle, and split across eligible revealed raters in each qualified
        bounty round after a 3% frontend-operator share. Accurate crowd predictions earn more, while near misses can
        receive a smaller payout for useful participation. Bundle bounties can require multiple settlement round sets;
        each set requires every bundled question to settle once and is claimed independently. If the commit-attributed
        frontend is not payable, that share stays with the rater claim. Bounty required-rater terms cannot exceed the
        question&apos;s selected rater cap, and bounty-paying questions currently keep that cap at 200 or lower.
      </p>
      <h3 id="feedback-bonuses">Feedback Bonuses</h3>
      <p>
        Feedback Bonuses are separate, optional USDC pools. They reward revealed raters for useful hidden feedback after
        settlement, pay immediately in the award transaction, reserve the same 3% eligible frontend share, and send
        expired unawarded USDC to treasury.
      </p>

      <h3>Treasury</h3>
      <p>
        The protocol treasury starts with <strong>32M LREP</strong> on the governor/timelock from launch. It grows over
        time through three main ongoing inflow sources: a 1% treasury fee on contested losing pools, cancellation fees
        from voluntary content withdrawals, and forfeited unrevealed past-epoch reports swept during settlement cleanup.
        Treasury spending follows the same governance proposal path as upgrades and other governed config changes.
      </p>
      <p>
        Appropriate treasury uses include ecosystem grants, partner activation, integration support, research and data
        work, protocol development, security responses, and whistleblower rewards. LREP grants are not protocol-backed
        payments; they distribute reputation and voting power, so proposals should state why the recipient should hold
        LREP and what follow-up reporting or milestone evidence governance voters should expect.
      </p>

      <hr />

      <h2>Round Payouts</h2>
      <p>
        When a round resolves, accurate revealed crowd predictions recover their original stake and claim from the
        content-specific rater pool. Revealed misses can reclaim{" "}
        <strong>{protocolDocFacts.revealedLoserRefundPercentLabel}</strong> of raw stake, and the remaining losing pool
        is split across accurate raters, frontend operators, consensus reserve, and treasury.
      </p>

      <hr />

      <h2>Staking Requirements</h2>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Action</th>
              <th>Stake</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Submit an RBTS vote</td>
              <td className="font-mono">0&ndash;10 LREP</td>
              <td>
                Zero-LREP votes can bootstrap earned launch reputation; larger stakes add normal settlement upside and
                risk
              </td>
            </tr>
            <tr>
              <td>Ask a question</td>
              <td className="font-mono">
                {protocolDocFacts.submissionLrepMinimumLabel} or {protocolDocFacts.submissionUsdcMinimumLabel}
              </td>
              <td>
                The minimum is non-refundable. It is attached at submission and pays eligible raters if the question
                qualifies. Bounties can use LREP or USDC.
              </td>
            </tr>
            <tr>
              <td>Fund a Feedback Bonus</td>
              <td className="font-mono">USDC only</td>
              <td>Optional; unawarded remainder goes to treasury after the award deadline</td>
            </tr>
            <tr>
              <td>Register as frontend</td>
              <td className="font-mono">1,000 LREP</td>
              <td>Returned on exit unless slashed</td>
            </tr>
            <tr>
              <td>Submit AI declaration</td>
              <td className="font-mono">{protocolDocFacts.declarationBondMinimumLabel}</td>
              <td>Operator bond required before a declaration can be treated as active and challengeable</td>
            </tr>
            <tr>
              <td>Challenge AI declaration</td>
              <td className="font-mono">{protocolDocFacts.challengeBondMinimumLabel}</td>
              <td>Challenge bond is forfeited to treasury if rejected</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Question creators no longer escrow separate capital beyond the bounty. Submission bounties are non-refundable
        and route to eligible raters and the eligible frontend operator once the question resolves.
      </p>
    </article>
  );
};

export default Tokenomics;
