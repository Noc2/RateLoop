import type { NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { OracleChallengeFlowDiagram } from "~~/components/docs/OracleChallengeFlowDiagram";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";

const GovernanceDocs: NextPage = () => {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Governance" />
      <p className="lead text-base-content/60 text-lg">
        LREP governance controls protocol settings, upgrades, treasury routing, and optional identity policy.
      </p>

      <h2 id="mainnet-beta">Mainnet Beta</h2>
      <p>
        RateLoop&apos;s Base mainnet contracts are live production infrastructure. The beta label covers operational
        maturity around governance participation, off-chain services, indexer reliability, operator tooling, and public
        documentation while the deployed contract stack remains the system of record.
      </p>
      <p>
        Routine configuration, indexing, UI, keeper, and operator issues should be resolved against the existing
        deployment. If a significant contract-level incident cannot be handled through governance, admin actions, or
        service rewiring, the community should publish a separate migration runbook that explains why the existing
        deployment cannot safely continue.
      </p>
      <p>
        As the protocol leaves beta, evolution continues through the normal governance process: proposals, voting,
        timelock review, and execution through the deployed governance system.
      </p>

      <h2>What Governance Does</h2>
      <p>
        LREP is a capped, non-financial reputation token with no protocol token sale and no treasury backing. Governance
        power comes from held, self-delegated LREP, and proposals execute through the governor and timelock. The current
        token auto-delegates voting power to the holder and rejects third-party LREP vote delegation.
      </p>
      <h2>Proposal Lifecycle</h2>
      <div className="not-prose my-6 overflow-x-auto rounded-lg bg-base-200">
        <table className="table table-zebra [&_th]:bg-base-300 [&_th]:text-base [&_td]:text-base">
          <thead>
            <tr>
              <th>State</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pending</td>
              <td>Created and waiting for the voting delay.</td>
            </tr>
            <tr>
              <td>Active</td>
              <td>Voting is open: For, Against, or Abstain.</td>
            </tr>
            <tr>
              <td>Queued</td>
              <td>Passed and waiting in the timelock.</td>
            </tr>
            <tr>
              <td>Executed</td>
              <td>The change is live.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Core Parameters</h2>
      <div className="not-prose my-6 overflow-x-auto rounded-lg bg-base-200">
        <table className="table table-zebra [&_th]:bg-base-300 [&_th]:text-base [&_td]:text-base">
          <tbody>
            <tr>
              <td className="font-mono">Proposal threshold</td>
              <td>{protocolDocFacts.governanceProposalThresholdLabel}</td>
            </tr>
            <tr>
              <td className="font-mono">Proposal threshold range</td>
              <td>{protocolDocFacts.governanceProposalThresholdRangeLabel}</td>
            </tr>
            <tr>
              <td className="font-mono">Voting delay</td>
              <td>~1 day</td>
            </tr>
            <tr>
              <td className="font-mono">Voting period</td>
              <td>~1 week</td>
            </tr>
            <tr>
              <td className="font-mono">Quorum</td>
              <td>{protocolDocFacts.governanceQuorumLabel}</td>
            </tr>
            <tr>
              <td className="font-mono">Timelock delay</td>
              <td>2 days</td>
            </tr>
            <tr>
              <td className="font-mono">Governance lock</td>
              <td>7 days after proposing or voting</td>
            </tr>
            <tr>
              <td className="font-mono">Voting delegation</td>
              <td>{protocolDocFacts.governanceVotingDelegationLabel}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Transferable LREP is an explicit launch choice, not an accidental cash-vote shortcut. Rating and payout
        influence are mitigated by prediction-accuracy scoring, effective-unit weighting, verified-human launch anchors,
        correlation payout snapshots, calibration and reveal reliability, while governance uses timelocks, voting locks,
        a quorum floor, and a proposal-threshold floor.
      </p>

      <h2>Cluster Payout Oracle</h2>
      <p>
        The ClusterPayoutOracle is a governance-managed target for payout accounting. It does not decide the public
        rating result. Instead, it stores challengeable correlation epoch roots and per-round payout roots that USDC
        bounty claims and launch LREP credits use after a round has already settled. Public rating settlement happens
        first; this flow only finalizes payout weights for claim paths.
      </p>
      <p>
        Payout roots are proposed by registered frontend operators that have bonded{" "}
        <strong>{protocolDocFacts.frontendOperatorStakeLabel}</strong> in the FrontendRegistry. Operators publish the
        deterministic artifact URI and root from their registered wallet or a delegated snapshot keeper that approved
        them first, then wait through the challenge window. Other operators or auditors can recompute the artifact and
        challenge bad roots with the configured USDC challenge bond, which defaults to 5 USDC.
      </p>
      <OracleChallengeFlowDiagram />
      <p>
        Governance controls oracle configuration, including the challenge window, challenger bond, frontend registry,
        and fallback bond recipient. It can also arbitrate challenged roots through proposals that either finalize a
        correct challenged root or reject an invalid one with a public reason hash, and can slash the proposing frontend
        through the FrontendRegistry if the on-chain-data computation was wrong. When a slash follows a rejected root,
        governance can use <code>slashFrontendWithBounty</code> to route a fixed 50% of everything confiscated — the
        stake cut, accrued fees, and any pending fee withdrawal — to the recorded challenger, so a correct challenge is
        directly profitable rather than just bond-neutral.
      </p>
      <p>
        The intended security model is optimistic rather than fully per-snapshot economically secured on-chain. Public
        artifacts, challenge windows, governance arbitration, and the globally bonded frontend-operator set are meant to
        make incorrect payout roots observable and punishable through frontend slashing, reputation loss, and future-fee
        loss. Frontend fee withdrawals wait out a 21-day slashable review window, so an operator&apos;s undelivered
        earnings act as collateral that grows with their usage — a misbehaving proposer forfeits the bond, weeks of fee
        income, and the future fee stream together.
      </p>

      <h2 id="round-settings-bounds">Round Settings Bounds</h2>
      <p>
        Question creators can choose round settings, but only inside governance-approved ranges. That lets urgent asks
        settle faster while broader questions can wait for more raters.
      </p>
      <div className="not-prose my-6 overflow-x-auto rounded-lg bg-base-200">
        <table className="table table-zebra [&_th]:bg-base-300 [&_th]:text-base [&_td]:text-base">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Default</th>
              <th>Creator bounds</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Blind phase</td>
              <td>{protocolDocFacts.blindPhaseDurationLabel}</td>
              <td>
                {protocolDocFacts.minBlindPhaseDurationLabel} to {protocolDocFacts.maxBlindPhaseDurationLabel}
              </td>
            </tr>
            <tr>
              <td>Max duration</td>
              <td>{protocolDocFacts.maxRoundDurationLabel}</td>
              <td>
                {protocolDocFacts.minRoundDurationLabel} to {protocolDocFacts.maxAllowedRoundDurationLabel}
              </td>
            </tr>
            <tr>
              <td>Settlement raters</td>
              <td>{protocolDocFacts.minVotersLabel}</td>
              <td>
                {protocolDocFacts.minSettlementVotersLabel} to {protocolDocFacts.maxSettlementVotersLabel};{" "}
                {protocolDocFacts.quorumRatchetPolicyLabel}
              </td>
            </tr>
            <tr>
              <td>Voter cap</td>
              <td>{protocolDocFacts.maxVotersLabel}</td>
              <td>
                {protocolDocFacts.minVoterCapLabel} to {protocolDocFacts.maxVoterCapLabel}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Treasury</h2>
      <p>
        The treasury starts with 25M LREP under governor/timelock control. Ongoing inflows include the treasury share of
        contested losing pools, withdrawal fees, and forfeited unrevealed reports. Spending follows the same proposal
        and timelock path as upgrades.
      </p>
      <p>
        Treasury grants can support work that grows the RateLoop feedback network: partner activation, integrations,
        research and data projects, community growth, protocol development, verification acceleration, appeals, and
        security or whistleblower rewards. These uses are treasury responsibilities rather than Launch Distribution Pool
        rewards. Because LREP also carries governance power, grant proposals should explain the recipient, purpose,
        amount, expected impact, and any milestone or reporting expectations.
      </p>

      <h2>Safety Powers</h2>
      <p>
        Governance can use public on-chain evidence to respond to collusion, repeated unrevealed commitments, clearly
        false self-reported context, or other behavior that damages the feedback signal. The main enforcement tools are
        parameter changes, payout snapshot challenge windows and bonds, oracle challenge arbitration, frontend stake
        slashing, calibration changes, optional credential policies, and treasury or pool routing through normal
        proposals.
      </p>
      <p>
        Confidential context adds a narrower safety path: raters accept per-question confidentiality terms before hosted
        context is served, access logs can be anchored as public evidence artifacts, and breach reports can route to
        governance for bond slashing or surplus-earnings sanctions. Sanctions are meant to protect gated-context access
        and future earning power, not to confiscate returned stake or cancelled-round refunds.
      </p>
      <h2>Protocol Evolution</h2>
      <p>
        RateLoop is expected to evolve over time, especially as AI systems become more capable and as new
        smart-contract, wallet, identity, and coordination vulnerabilities are discovered. Governance was integrated
        from the start so the community can adapt protocol parameters, treasury routing, and safety rules without
        relying on informal operator discretion.
      </p>
      <p>
        During and after beta, protocol changes should use the deployed governance path wherever possible. Material
        changes should be documented, reviewable, and aligned with the same proposal, voting, and timelock principles
        that control upgrades and configuration changes.
      </p>
    </article>
  );
};

export default GovernanceDocs;
