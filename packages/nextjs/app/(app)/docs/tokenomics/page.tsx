import { DocsTitle } from "~~/components/docs/DocsTitle";
import { TokenAllocationChart } from "~~/components/docs/TokenAllocationChart";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";
import { LREP_MAX_SUPPLY_LABEL } from "~~/lib/docs/tokenomics";

const Tokenomics = () => {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Tokenomics" />
      <p className="lead text-base-content/60 text-lg">
        Loop Reputation (LREP) token distribution, question funding, and reward mechanics.
      </p>

      <h2>Overview</h2>
      <p>
        Loop Reputation (LREP) is a capped, transferable, non-financial reputation and governance token. It is not
        intended as an investment, has no protocol token sale and no treasury backing; supply is distributed through
        protocol-controlled pools, earned protocol rewards, and governance-approved programs.
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
              <td>Transferable non-financial reputation and governance token</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Supply is fixed at <strong>100 million LREP</strong>. The full supply is minted at launch into
        protocol-controlled pools, with no team allocation or token sale.
      </p>
      <hr />

      <h2>Launch Distribution Pool</h2>
      <p>
        The 68M LREP Launch Distribution Pool is the protocol&apos;s onboarding engine. It is not a large airdrop to the
        previous user set. The split is <strong>35M LREP</strong> for verified + referral rewards,{" "}
        <strong>33M LREP</strong> for earned rater rewards.
      </p>
      <TokenAllocationChart />
      <p>
        New users can start with a zero-LREP advisory path in rounds that already have a staked vote. Advisory ratings
        do not count toward settlement quorum, but eligible settled advisory rounds can qualify for launch credits.
        Staking LREP remains available for raters who want normal winner/loser settlement upside and downside.
      </p>
      <p>
        Earned rater rewards are open to any rater, including agents, but the launch pool only counts ratings from
        verified-human anchored rounds. The initial policy requires three revealed raters, one verified human in the
        round, a minimum launch-credit stake for staked votes, two distinct verified-human anchors across a rater&apos;s
        qualifying history, bounded anchor fanout, round-level unverified-credit caps, aged anchor credentials, and a
        finalized correlation payout snapshot before payouts begin. Correlated accounts accrue fractional effective
        credit, so they may need more rounds before LREP starts paying. Full caps start at <strong>10 LREP</strong> and
        step down through 5, 2.5, 1.25, and 0.5 LREP so the 33M LREP earned rater rail can support about 24.6M fully
        paid recipients. Open raters can be given a governed partial cap and later unlock the full snapshotted cap by
        verifying the same wallet as a human. Governance can tighten these thresholds over time. Agent wallets do not
        count as human anchors unless they hold an active verified-human credential.
      </p>
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
              <td>Human uniqueness only; AI participation does not change reward weight</td>
            </tr>
            <tr>
              <td>Referrals</td>
              <td>Valid referrer and referred rater activity</td>
              <td className="font-mono">Small bounded bonus</td>
              <td>Designed to reward real onboarding, not passive invite farming</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Verification acceleration, safety responses, appeals, and governance programs are treasury responsibilities.
        They do not draw from the Launch Distribution Pool. The previous 12M Bootstrap Pool allocation and former 4M
        LREP consensus reserve allocation are folded into launch distribution: 35M LREP funds verified + referral
        rewards, and 33M LREP funds earned rater rewards.
      </p>

      <h2>Treasury</h2>
      <p>
        The protocol treasury starts with <strong>32M LREP</strong> on the governor/timelock from launch. It grows over
        time through governance-routed settlement remainder, cancellation fees from voluntary content withdrawals, and
        forfeited unrevealed past-epoch reports swept during settlement cleanup. Treasury spending follows the same
        governance proposal path as upgrades and other governed config changes.
      </p>
      <p>
        Appropriate treasury uses include ecosystem grants, partner activation, integration support, research and data
        work, protocol development, security responses, and whistleblower rewards. LREP grants are not protocol-backed
        payments; they distribute reputation and voting power, so proposals should state why the recipient should hold
        LREP and what follow-up reporting or milestone evidence governance voters should expect.
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
              <td>Submit a rating</td>
              <td className="font-mono">0&ndash;10 LREP</td>
              <td>
                Zero-LREP advisory votes require an existing staked vote and do not count toward settlement quorum;
                larger staked votes add normal settlement upside and risk
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
              <td className="font-mono">{protocolDocFacts.frontendOperatorStakeLabel}</td>
              <td>Returned on exit unless slashed; also backs operator payout-root proposals</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Question creators no longer escrow separate capital beyond the bounty. Submission bounties are non-refundable
        and route to eligible raters and the eligible frontend operator once the question resolves and any required
        correlation payout roots finalize.
      </p>
    </article>
  );
};

export default Tokenomics;
