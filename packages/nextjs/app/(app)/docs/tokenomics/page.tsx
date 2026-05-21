import { DocsTitle } from "~~/components/docs/DocsTitle";
import { TokenAllocationChart } from "~~/components/docs/TokenAllocationChart";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";
import {
  LREP_MAX_SUPPLY_LABEL,
  earnedRaterRewardScheduleRows,
  launchRewardOverviewRows,
  legacyContributorVestingRows,
  verifiedReferralRewardScheduleRows,
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
        The 75M LREP Launch Distribution Pool is the protocol&apos;s onboarding and contributor-distribution engine. The
        split is <strong>42M LREP</strong> for human verified + referral rewards, <strong>24M LREP</strong> for earned
        rater rewards, and <strong>9M LREP</strong> for legacy contributors.
      </p>
      <TokenAllocationChart />
      <p>
        New users can start with a zero-LREP advisory path in rounds that already have a staked vote. Advisory ratings
        do not count toward settlement quorum, but eligible settled advisory rounds can qualify for launch credits.
        Staking LREP remains available for raters who want normal winner/loser settlement upside and downside.
      </p>
      <p>
        Launch rewards are deliberately front-loaded. Verified humans can claim once, verified referrers can earn when a
        referred user verifies, useful raters can earn from qualifying verified-human anchored rounds, and eligible
        legacy contributors can claim a prior-allocation-based grant until the 27-month deadline. Amounts below are
        maximums; cluster-capped effective credit, vesting state, pool balance, claim expiry, and governance updates can
        reduce or pause payouts.
      </p>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Reward</th>
              <th>How to earn</th>
            </tr>
          </thead>
          <tbody>
            {launchRewardOverviewRows.map(row => (
              <tr key={row.reward}>
                <td className="font-medium">{row.reward}</td>
                <td>{row.howToEarn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="not-prose my-6 grid gap-4 2xl:grid-cols-2">
        <div className="overflow-x-auto rounded-xl bg-base-200">
          <table className="table table-zebra [&_th]:bg-base-300">
            <caption className="caption-top px-4 py-3 text-left text-sm font-semibold text-base-content">
              Verified + referral reward schedule
            </caption>
            <thead>
              <tr>
                <th>Verified claim order</th>
                <th>Verified user</th>
                <th>Referrer</th>
              </tr>
            </thead>
            <tbody>
              {verifiedReferralRewardScheduleRows.map(([claimOrder, verifiedBonus, referralBonus]) => (
                <tr key={claimOrder}>
                  <td className="font-mono">{claimOrder}</td>
                  <td className="font-mono">{verifiedBonus}</td>
                  <td className="font-mono">{referralBonus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-xl bg-base-200">
          <table className="table table-zebra [&_th]:bg-base-300">
            <caption className="caption-top px-4 py-3 text-left text-sm font-semibold text-base-content">
              Earned rater reward cap schedule
            </caption>
            <thead>
              <tr>
                <th>Eligible rater order</th>
                <th>Full cap</th>
                <th>Unverified cap</th>
                <th>Per slot</th>
              </tr>
            </thead>
            <tbody>
              {earnedRaterRewardScheduleRows.map(([raterOrder, fullCap, unverifiedCap, perSlot]) => (
                <tr key={raterOrder}>
                  <td className="font-mono">{raterOrder}</td>
                  <td className="font-mono">{fullCap}</td>
                  <td className="font-mono">{unverifiedCap}</td>
                  <td className="font-mono">{perSlot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:bg-base-300">
          <caption className="caption-top px-4 py-3 text-left text-sm font-semibold text-base-content">
            Legacy contributor vesting
          </caption>
          <thead>
            <tr>
              <th>When</th>
              <th>Vested amount</th>
              <th>Claim behavior</th>
            </tr>
          </thead>
          <tbody>
            {legacyContributorVestingRows.map(([when, vestedAmount, claimBehavior]) => (
              <tr key={when}>
                <td>{when}</td>
                <td className="font-mono">{vestedAmount}</td>
                <td>{claimBehavior}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        Earned-rater rewards use up to 10 payout slots after the first 5 qualifying launch credits. The default
        unverified cap is 25% of the full cap; verifying the same wallet later can unlock the full snapshotted cap and
        any eligible catch-up payment. Agent wallets can earn as raters, but they do not count as human anchors unless
        they hold an active verified-human credential.
      </p>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Earned-rater launch credit requirements</th>
              <th>Initial policy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Minimum qualifying score</td>
              <td className="font-mono">70%</td>
            </tr>
            <tr>
              <td>Revealed raters in the round</td>
              <td className="font-mono">3+</td>
            </tr>
            <tr>
              <td>Verified-human anchors</td>
              <td>1 in the round, plus 2 distinct anchors across qualifying history</td>
            </tr>
            <tr>
              <td>Minimum staked-vote launch-credit stake</td>
              <td className="font-mono">1 LREP</td>
            </tr>
            <tr>
              <td>Snapshot gate</td>
              <td>Finalized correlation payout snapshot before payout</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>Treasury</h2>
      <p>
        The protocol treasury starts with <strong>25M LREP</strong> on the governor/timelock from launch. It grows over
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
