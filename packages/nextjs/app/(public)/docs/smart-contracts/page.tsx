import type { NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { ProtocolPiecesDiagram } from "~~/components/docs/ProtocolPiecesDiagram";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";

const contractsSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/foundry/contracts";
const deploymentsSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/foundry/deployments";
const tsContractsSourceHref = "https://github.com/Noc2/RateLoop/tree/main/packages/contracts";
const robustBtsHref = "https://doi.org/10.1609/aaai.v26i1.8261";

const SmartContracts: NextPage = () => {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Contracts">Smart</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Technical reference for the RateLoop smart contract architecture.
      </p>

      <h2>Architecture</h2>
      <p>
        The upgradeable control-plane contracts use <strong>transparent proxies</strong> managed by timelock-owned proxy
        admins: ContentRegistry, ProtocolConfig, RoundVotingEngine, RoundRewardDistributor, FrontendRegistry, and
        ProfileRegistry, plus the QuestionRewardPoolEscrow and FeedbackBonusEscrow custody contracts. Token, rater
        identity, launch distribution, participation, governance, and helper contracts are intentionally
        non-upgradeable.
      </p>
      <p>
        The Solidity sources live in{" "}
        <a href={contractsSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          packages/foundry/contracts
        </a>
        , deployment artifacts live in{" "}
        <a href={deploymentsSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          packages/foundry/deployments
        </a>
        , and the shared TypeScript ABIs and address helpers used by the app and SDK live in{" "}
        <a href={tsContractsSourceHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
          packages/contracts
        </a>
        .
      </p>
      <ProtocolPiecesDiagram />
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Role</th>
              <th>Upgradeable</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-mono text-primary">LoopReputation</td>
              <td>ERC-20 token (LREP) with governance voting power, treasury mint controls, and governance locks</td>
              <td>No</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">RaterRegistry</td>
              <td>
                Rater identity, optional human credentials, delegation, profile follows, and verified-human anchor reads
              </td>
              <td>No</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">ContentRegistry</td>
              <td>Content lifecycle: submission, dormancy, rating updates, slashing</td>
              <td>Transparent</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">ProtocolConfig</td>
              <td>Governance-controlled address book and round configuration for RoundVotingEngine</td>
              <td>Transparent</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">ClusterPayoutOracle</td>
              <td>
                Governance-managed optimistic correlation epoch and round payout snapshots proposed by bonded frontend
                operators for USDC and launch LREP claims, with USDC challenge bonds
              </td>
              <td>No</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">RoundVotingEngine</td>
              <td>Core voting: tlock commit-reveal voting, epoch-weighted rewards, deterministic settlement</td>
              <td>Transparent</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">RoundRewardDistributor</td>
              <td>Pull-based reward claiming for settled rounds</td>
              <td>Transparent</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">FrontendRegistry</td>
              <td>Frontend operator registration and fee distribution</td>
              <td>Transparent</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">CategoryRegistry</td>
              <td>Seeded discovery category metadata</td>
              <td>No</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">LaunchDistributionPool</td>
              <td>
                75M LREP launch distribution: 42M verified/referral, 24M anchor-gated earned rater rewards, and 9M
                legacy contributor vesting with 27-month claim expiry
              </td>
              <td>No</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">QuestionRewardPoolEscrow</td>
              <td>Question-scoped LREP or USDC custody, voter rewards, and the frontend-operator reward share</td>
              <td>Transparent</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">FeedbackBonusEscrow</td>
              <td>Question-scoped LREP or USDC bonuses for awarded voter feedback hashes</td>
              <td>Transparent</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">ProfileRegistry</td>
              <td>On-chain user profiles with unique names, images, and public self-reported audience context</td>
              <td>Transparent</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">RateLoopGovernor</td>
              <td>On-chain governance with timelock (proposals, voting, execution)</td>
              <td>No</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">RoundLib</td>
              <td>Library: round state management and settlement logic</td>
              <td>&mdash;</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">RewardMath</td>
              <td>
                Library:{" "}
                <a href={robustBtsHref} target="_blank" rel="noopener noreferrer" className="link link-primary">
                  Robust Bayesian Truth Serum (RBTS)
                </a>{" "}
                score-spread settlement, forfeited-pool routing, and reward calculations
              </td>
              <td>&mdash;</td>
            </tr>
            <tr>
              <td className="font-mono text-primary">TokenTransferLib</td>
              <td>Library: narrow token transfer helpers used by reward settlement paths</td>
              <td>&mdash;</td>
            </tr>
          </tbody>
        </table>
      </div>

      <hr />

      <h2>LoopReputation</h2>
      <p>
        ERC-20 token with ERC20Votes for governance, ERC20Permit for scoped approvals, and a capped reputation supply.
        The rating flow supports explicit LREP approvals into the voting engine when a rater chooses to stake.
      </p>
      <h3>Key Features</h3>
      <ul>
        <li>
          <strong>Governance voting power:</strong> Delegates can vote on proposals via RateLoopGovernor.
        </li>
        <li>
          <strong>Governance lock:</strong> Tokens become non-transferable for 7 days when proposing or voting on
          governance proposals. This is a transfer lock, not a per-proposal escrowed bond.
        </li>
        <li>
          <strong>Snapshot-based governance:</strong> ERC20Votes provides historical voting-power snapshots for
          governance, while LREP transfer locks apply after proposing or voting.
        </li>
        <li>
          <strong>Supply cap:</strong> Distribution and reward recycling stay bounded by <code>MAX_SUPPLY</code>.
        </li>
        <li>
          <strong>Rating stake:</strong> The production UI can approve optional LREP stake and submits a private up/down
          signal plus expected up-vote percentage through <code>commitVote()</code>. Zero-LREP advisory votes can
          participate only after a round already has a staked vote; they do not count toward settlement quorum, but
          eligible settled advisory rounds can qualify for launch credits.
        </li>
      </ul>
      <h3>Key Functions</h3>
      <ul>
        <li>
          <code>approve(votingEngine, amount)</code> &mdash; Allow the voting engine to pull LREP stake for a
          prediction.
        </li>
        <li>
          <code>lockForGovernance(account, amount)</code> &mdash; Lock tokens for 7 days (governor only).
        </li>
        <li>
          <code>getTransferableBalance(account)</code> &mdash; Returns balance minus locked amount.
        </li>
        <li>
          <code>delegate(delegatee)</code> &mdash; Self-delegate LREP voting power; the current token rejects
          third-party vote delegation.
        </li>
      </ul>

      <hr />

      <h2>RaterRegistry</h2>
      <p>
        The single rater identity surface. It stores optional wallet-bound human credentials, rater profile metadata,
        profile follows, and delegation links for cold-wallet and agent-wallet operation.
      </p>
      <h3>Sybil Resistance</h3>
      <p>
        RaterRegistry credentials are optional for the core rating path, but give the protocol a stable rater anchor for
        delegated voting, verified-human launch rewards, and other identity-aware flows. USDC-funded question submission
        is permissionless and does not require a human credential. Where identity stake caps are active, they prevent a
        single rater identity from dominating any vote.
      </p>
      <h3>Key Functions</h3>
      <ul>
        <li>
          <code>attestHumanCredentialWithProof(root, nullifierHash, proof)</code> &mdash; Verify a World ID v3 Proof of
          Human credential and attach it to the submitting wallet.
        </li>
        <li>
          <code>attestHumanCredentialWithV4Proof(nullifier, nonce, expiresAtMin, proof)</code> &mdash; Reserved for a
          future governance upgrade to World ID v4 Proof of Human.
        </li>
        <li>
          <code>seedHumanCredential(rater, expiresAt, anchorId, evidenceHash)</code> &mdash; Seed an approved human
          credential for local development, tests, or governance-admin repair.
        </li>
        <li>
          <code>hasActiveHumanCredential(rater)</code> / <code>getHumanCredential(rater)</code> &mdash; Read credential
          status and metadata.
        </li>
        <li>
          <code>setProfile(raterType, metadataHash)</code> &mdash; Publish rater metadata used by identity-aware
          clients.
        </li>
      </ul>
      <h3>Delegation</h3>
      <p>
        RaterRegistry supports delegation: a credential holder or rater identity wallet can authorize a delegate (hot
        wallet or agent wallet) to act on their behalf for flows that accept delegated identities, notably voting and
        daily profile/frontend actions. Holder-only recovery and delegation management still require the identity
        wallet. Setup and security guidance live in the <code>/settings?tab=delegation</code> flow.
      </p>
      <ul>
        <li>
          <code>setDelegate(address)</code> &mdash; Authorize a delegate (holder only).
        </li>
        <li>
          <code>removeDelegate()</code> &mdash; Revoke delegate authorization (holder only).
        </li>
        <li>
          <code>resolveHolder(address)</code> &mdash; Returns the effective rater identity for an address.
        </li>
      </ul>

      <hr />

      <h2>ContentRegistry</h2>
      <p>
        Manages content lifecycle. Each item has a unique ID and content hash stored on-chain; full URL and metadata are
        emitted via events.
      </p>
      <p>
        ContentRegistry validates submitted evidence and media links against CategoryRegistry before deriving the
        question submission key from the submitted metadata. The question-first flow accepts either a context URL or at
        least one public image, plus a mandatory non-refundable bounty attached at submission in LREP or USDC.
      </p>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Status</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="badge badge-secondary badge-sm">Active</span>
              </td>
              <td>Accepting votes. Default state after submission.</td>
            </tr>
            <tr>
              <td>
                <span className="badge badge-secondary badge-sm">Dormant</span>
              </td>
              <td>
                No meaningful activity for 30 days. The original submitter can revive it up to 2 times during the 1-day
                exclusive revival window before the dormant key becomes releasable.
              </td>
            </tr>
            <tr>
              <td>
                <span className="badge badge-secondary badge-sm">Cancelled</span>
              </td>
              <td>Voluntarily removed by the submitter before votes. No cancellation fee is charged.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Key Functions</h3>
      <ul>
        <li>
          <code>reserveSubmission(revealCommitment)</code>, then{" "}
          <code>
            submitQuestionWithRewardAndRoundConfig(..., details, rewardTerms, roundConfig, spec, confidentiality)
          </code>{" "}
          &mdash; Reserve a hidden question, then reveal it with the exact attached bounty terms, creator-selected round
          config, optional off-chain details URL/hash, explicit confidentiality terms, and two non-zero metadata hashes:{" "}
          <code>questionMetadataHash</code> and <code>resultSpecHash</code>. Question text is capped at 120 characters,
          the context/media/details submission key is checked for duplicates, and the question plus description are
          emitted in the canonical <code>ContentSubmitted</code> event for indexers and alternate frontends. The
          subjective template, rationale, and interpretation data stays off-chain; the contract commits to its hashes in{" "}
          <code>contentHash</code> and emits optional details through <code>ContentDetailsSubmitted</code>. Agent asks
          use the same function after the user or scoped agent wallet executes the returned funding and submission
          calls. <code>rewardTerms</code> also commits to bounty eligibility: everyone or Proof of Human for the v3
          launch. <code>rewardTerms.requiredVoters</code> must match <code>roundConfig.minVoters</code> so a settled
          qualifying round is also bounty-qualifying, and bounty size can raise the required participant floor.
        </li>
        <li>
          <code>submitQuestionBundleWithRewardAndRoundConfig(..., rewardTerms, roundConfig)</code> &mdash; Submit a
          ranked-option bundle with one bounty shared across sibling questions. The bounty funds the creation-anchored
          bundle round set, which is complete only after every bundled question has one settled round. Private context
          bundles are not accepted yet; submit gated questions individually until the uniform bundle-confidentiality
          path is added.
        </li>
        <li>
          <code>getContentRoundConfig(contentId)</code> &mdash; Returns the shared question duration, settlement voters,
          and voter cap selected for that question. Existing submit functions without an explicit round config still use
          the governed default.
        </li>
        <li>
          <code>cancelContent(contentId)</code> &mdash; Cancel own content before votes. Attached submission bounties
          stay non-refundable, and no cancellation fee is charged.
        </li>
        <li>
          <code>markDormant(contentId)</code> &mdash; Mark inactive content as dormant after 30 days. Permissionless;
          reverts if content has an active open round.
        </li>
        <li>
          <code>reviveContent(contentId)</code> &mdash; Revive dormant content (5 LREP, max 2 times). Only the original
          submitter identity can do this, and only during the 1-day exclusive revival window.
        </li>
        <li>
          <code>updateRatingState(contentId, roundId, referenceRatingBps, nextState)</code> &mdash; Called by
          RoundVotingEngine after settlement with the rating update derived from bounded up/down signal evidence, the
          internal reference prior, and the conservative rating bound. Fresh content can use the internal default prior
          while the public UI still shows <strong>N/A</strong> until the first settlement.
        </li>
      </ul>
      <h3>Submission Economics</h3>
      <p>
        Question submissions no longer carry refundable creator deposits or creator-side launch rewards. The attached
        bounty is non-refundable and routes to eligible voters plus the eligible frontend operator.
      </p>

      <hr />

      <h2>RoundVotingEngine</h2>
      <p>
        Manages per-content voting rounds with tlock commit-reveal voting, explicit drand metadata binding,
        epoch-weighted rewards, and deterministic settlement. One-sided rounds do not receive a consensus subsidy.
        Commit-time reward weight is stake times the epoch timing weight; human credentials do not multiply settlement
        rewards.
      </p>
      <h3>Configuration</h3>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Value</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-mono">MIN_STAKE</td>
              <td>1 LREP</td>
              <td>
                Minimum counted vote stake; zero-LREP advisory ratings route separately and do not count toward
                settlement quorum
              </td>
            </tr>
            <tr>
              <td className="font-mono">MAX_STAKE</td>
              <td>10 LREP</td>
              <td>Maximum counted vote stake per rater identity per round when identity stake caps are active</td>
            </tr>
            <tr>
              <td className="font-mono">questionDurationSeconds</td>
              <td>{protocolDocFacts.questionDurationLabel}</td>
              <td>
                Shared blind response, bounty eligibility, and Feedback Bonus duration; creators can select within
                governance bounds.
              </td>
            </tr>
            <tr>
              <td className="font-mono">minVoters</td>
              <td>{protocolDocFacts.minVotersLabel}</td>
              <td>
                Launch default minimum revealed votes required before settlement is allowed. Bounty voter floors can
                rise with bounty size: {protocolDocFacts.bountyParticipantFloorsLabel}.{" "}
                {protocolDocFacts.quorumRatchetPolicyLabel}
              </td>
            </tr>
            <tr>
              <td className="font-mono">SCORE_SPREAD_FORFEIT_MIN_REVEALS</td>
              <td>{protocolDocFacts.scoreSpreadForfeitMinRevealsLabel}</td>
              <td>Minimum score-eligible revealed voters before negative score-spread LREP forfeits can apply.</td>
            </tr>
            <tr>
              <td className="font-mono">MAX_SCORE_SPREAD_FORFEIT_BPS</td>
              <td>{protocolDocFacts.maxScoreSpreadForfeitPercentLabel}</td>
              <td>Per-report cap on negative score-spread LREP forfeiture once the economic threshold is met.</td>
            </tr>
            <tr>
              <td className="font-mono">maxVotersPerRound</td>
              <td>{protocolDocFacts.maxVotersLabel}</td>
              <td>Default cap on voters per content per round and upper bound for bounty voter requirements.</td>
            </tr>
            <tr>
              <td className="font-mono">revealGracePeriod</td>
              <td>{protocolDocFacts.revealGracePeriodLabel}</td>
              <td>Time after each epoch during which all past-epoch votes must be revealed before settlement</td>
            </tr>
            <tr>
              <td className="font-mono">VOTE_COOLDOWN</td>
              <td>24 hours</td>
              <td>Time before the same resolved rater identity can vote on the same content again</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Key Functions</h3>
      <ul>
        <li>
          <code>LoopReputation.approve(votingEngine, stakeAmount)</code> then{" "}
          <code>
            RoundVotingEngine.commitVote(contentId, roundContext, targetRound, drandChainHash, commitHash, ciphertext,
            stakeAmount, frontend)
          </code>{" "}
          &mdash; Default private rating flow. Locks LREP and records the tlock-encrypted up/down signal plus expected
          up-vote percentage. The report is hidden until the epoch ends. The redeployed contract rejects malformed or
          non-armored ciphertexts, binds the canonical internal rating prior into the round context, and binds the
          reveal-target metadata on-chain. The prior is not a user-facing vote target; raters submit an absolute
          thumbs-up/down signal and a separate crowd forecast.
        </li>
        <li>
          <code>commitVote(...)</code> &mdash; Lower-level integration path for agents, tests, and direct contract
          callers that build the approve-plus-commit flow directly.
        </li>
        <li>
          <strong>VoteCommitted event:</strong> emits the commit hash, <code>targetRound</code>, and{" "}
          <code>drandChainHash</code> so indexers can observe the exact reveal metadata attached to each report. The
          redeployed engine also snapshots <code>roundReferenceRatingBps</code> and emits{" "}
          <code>RoundConfigSnapshotted</code> per round so every frontend can recover the exact score anchor and round
          settings users rated against.
        </li>
        <li>
          <code>revealVoteByCommitKey(contentId, roundId, commitKey, isUp, predictedUpBps, salt)</code> &mdash; Reveal a
          previously committed rating report after the epoch ends. This remains the keeper-assisted/self-reveal path:
          the keeper normally performs off-chain drand/tlock decryption after validating the stored stanza metadata and
          submits the reveal, but any caller that knows the plaintext <code>(isUp, predictedUpBps, salt)</code> can
          submit it. The production UI keeps this mostly hidden, but connected users also have a small manual fallback
          link if an auto-reveal appears delayed. The chain binds the reveal to the exact submitted ciphertext via{" "}
          <code>keccak256(ciphertext)</code> and now rejects malformed/non-armored commits on-chain, but it still does
          not prove on-chain that the ciphertext was honestly decryptable. A future hardening path here would be
          zk-based reveal proofs.
        </li>
        <li>
          <code>settleRound(contentId, roundId)</code> &mdash; Settle the current round once at least{" "}
          <code>max(minVoters, 3)</code> votes from the round snapshot are revealed and all past-epoch votes have been
          revealed (or their {protocolDocFacts.revealGracePeriodLabel} reveal grace period has expired). Determines
          winners based on epoch-weighted stakes, scores rating rewards from the signal and crowd forecast, and records
          pending public-rating evidence from bounded binary signal evidence. The visible rating moves after the
          finalized public-rating snapshot and veto window; bounty, launch-LREP, and public-rating correlation caps use
          the ClusterPayoutOracle domains for their respective paths.
        </li>
        <li>
          <code>RoundRewardDistributor.claimFrontendFee(contentId, roundId, frontend)</code> &mdash; Frontend operators
          claim their proportional share of the 3% frontend fee pool. Pull-based and operator-only. Historical fee
          shares still follow the commit-time eligibility snapshot, but if the frontend is slashed or underbonded at
          claim time, governance can route the claim to the protocol instead of accruing it to the operator.
        </li>
        <li>
          <code>QuestionRewardPoolEscrow.claimQuestionReward(rewardPoolId, roundId, payoutWeight, proof)</code> &mdash;
          Claim the USDC-backed bounty for a revealed voter after the round has a finalized correlation payout snapshot.
          Snapshot roots are proposed through <code>ClusterPayoutOracle</code> by registered frontend operators bonded
          with 1,000 LREP, either directly or through assigned keeper wallets, then finalized after the challenge
          window. Bad roots can be challenged with the configured USDC ERC20 bond, which defaults to 5 USDC (5_000_000
          atomic units). New bounties default to a 3% frontend-operator share, attributed from the vote commit;
          unpayable frontend shares remain with the voter claim. Bounty eligibility and correlation caps gate this
          payout path, while a separate public-rating oracle domain controls visible rating movement from pending
          settlement evidence.
        </li>
        <li>
          <code>QuestionRewardPoolEscrow.claimQuestionBundleReward(bundleId, roundSetIndex)</code> &mdash; Claim a
          bundle bounty round set after the voter revealed on every bundled question in that set. Multi-round bundles
          create one claimable allocation per completed round set.
        </li>
        <li>
          <code>FeedbackBonusEscrow.awardFeedbackBonus(poolId, recipient, feedbackHash, grossAmount)</code> &mdash; Pay
          an awarded feedback hash that was published by the requested feedback close directly to a revealed,
          independent voter until the later of that close and 24 hours after settlement. The awarder pays this
          transaction, the recipient receives USDC or LREP immediately, and an eligible vote-attributed frontend
          receives the 3% share.
        </li>
        <li>
          <code>FeedbackBonusEscrow.forfeitExpiredFeedbackBonus(poolId)</code> &mdash; Send unawarded Feedback Bonus
          funds to treasury only after the effective award deadline has elapsed.
        </li>
        <li>
          <code>cancelExpiredRound(contentId, roundId)</code> &mdash; Cancel a round that exceeded question duration (
          {protocolDocFacts.questionDurationLabel}) without reaching commit quorum (<code>minVoters</code> total
          commits). Refundable to participants.
        </li>
        <li>
          <code>finalizeRevealFailedRound(contentId, roundId)</code> &mdash; Finalize a round that reached commit
          quorum, but still failed to reach reveal quorum after voting closed and the final reveal grace deadline
          passed.
        </li>
        <li>
          <code>claimCancelledRoundRefund(contentId, roundId)</code> &mdash; Claim refund for a cancelled, tied, or
          reveal-failed round.
        </li>
      </ul>

      <hr />

      <h2>ProtocolConfig</h2>
      <p>
        Governance-controlled address book and parameter store for <code>RoundVotingEngine</code>. Governance sets the
        default round config and creator bounds; each question then stores its selected config, and the engine snapshots
        that config plus reveal grace at round creation so mid-round governance changes do not change an already open
        round. {protocolDocFacts.quorumRatchetPolicyLabel}
      </p>
      <ul>
        <li>
          <code>setConfig(questionDurationSeconds, questionDurationSeconds, minVoters, maxVoters)</code> &mdash; Update
          round parameters for future questions that use the default config.
        </li>
        <li>
          <code>setRoundConfigBounds(...)</code> and <code>validateRoundConfig(...)</code> &mdash; Define and enforce
          the allowed creator-selected range for question duration, settlement voters, and voter cap.
        </li>
        <li>
          <code>setRevealGracePeriod(seconds)</code> &mdash; Update the grace period used for future round snapshots.
        </li>
        <li>
          <code>setRewardDistributor(...)</code>, <code>setFrontendRegistry(...)</code>,{" "}
          <code>setCategoryRegistry(...)</code>, <code>setRaterRegistry(...)</code>, and <code>setTreasury(...)</code>{" "}
          &mdash; Maintain the engine&apos;s governance-controlled address book, including the rater identity registry
          used by delegation and launch-anchor policy.
        </li>
      </ul>

      <hr />

      <hr />

      <h2>RoundRewardDistributor</h2>
      <p>
        Pull-based reward claiming. <strong>Not pausable</strong> &mdash; users can always withdraw their tokens.
      </p>
      <ul>
        <li>
          <code>claimReward(contentId, roundId)</code> &mdash; Claim settled-round voter payouts. Positive RBTS score
          spreads receive full stake plus their share of the 96% voter share of forfeited stake remaining after the
          settlement-caller incentive; negative spreads forfeit without a revealed-loser rebate once the score-spread
          economic threshold is met.
        </li>
        <li>
          <code>sweepStrandedLrepToTreasury()</code> &mdash; Governance-only recovery path for any LREP mistakenly sent
          directly to the distributor.
        </li>
      </ul>

      <hr />

      <h2>FrontendRegistry</h2>
      <p>
        Manages frontend operator registration and fee distribution. Frontend operators stake a fixed 1,000 LREP and
        receive {protocolDocFacts.frontendShareLabel} for each settled two-sided round they facilitated votes in. This
        global operator bond also backs optimistic payout-root proposals; the oracle design relies on public artifacts,
        challenge windows, governance arbitration, and possible slashing or future-income loss rather than fully
        collateralizing each snapshot on-chain. Fee withdrawals are delayed behind a 21-day slashable review window and
        successful oracle challengers receive a fixed share of slash proceeds, so accountability scales with an
        operator&apos;s actual earnings instead of requiring per-snapshot bonds.
      </p>
      <h3>Key Functions</h3>
      <ul>
        <li>
          <code>register()</code> &mdash; Register as frontend operator with the fixed 1,000 LREP stake.
        </li>
        <li>
          <code>requestDeregister()</code> / <code>completeDeregister()</code> &mdash; Start voluntary exit, then
          withdraw stake + pending fees after the unbonding window elapses.
        </li>
        <li>
          <code>topUpStake(amount)</code> &mdash; Restore the fixed 1,000 LREP bond after a partial slash so the
          frontend becomes fee-eligible again.
        </li>
        <li>
          <code>setSnapshotProposer(proposer)</code> and <code>clearSnapshotProposer()</code> &mdash; Assign or clear a
          separate operational wallet for payout-root proposal transactions while the frontend operator remains bonded.
        </li>
        <li>
          <code>setAccessRecorder(recorder)</code> and <code>clearAccessRecorder()</code> &mdash; Assign or clear a
          separate operational wallet for frontend-scoped confidentiality access-log root anchors.
        </li>
        <li>
          <code>requestFeeWithdrawal()</code> / <code>completeFeeWithdrawal()</code> &mdash; Two-step withdrawal of
          accumulated platform fees while healthy, fully bonded, and not exiting. The requested amount stays in the
          registry and remains fully slashable for a 21-day review window before it can be completed, so the fee stream
          works as collateral that grows with the operator&apos;s usage.
        </li>
        <li>
          <code>slashFrontend(address, amount, reason)</code> &mdash; Slash frontend stake (governance). Already accrued
          frontend fees and any pending fee withdrawal are confiscated to the protocol at the same time.
        </li>
        <li>
          <code>slashFrontendWithBounty(address, amount, reason, bountyRecipient)</code> &mdash; Same as{" "}
          <code>slashFrontend</code>, but routes a fixed 50% of everything confiscated to the successful
          ClusterPayoutOracle challenger named by governance, keeping the challenge path economically live. The share is
          deliberately below 100% so a proposer cannot recover its own collateral by self-challenging through a fresh
          wallet.
        </li>
      </ul>

      <hr />

      <h2>CategoryRegistry</h2>
      <p>
        Stores simple seeded discovery categories. Categories are metadata used to help people find and interpret
        content; they do not require user staking or governance approval proposals.
      </p>
      <h3>Key Functions</h3>
      <ul>
        <li>
          <code>addCategory(name, slug, subcategories)</code> &mdash; Add seeded category metadata (ADMIN_ROLE).
        </li>
      </ul>

      <hr />

      <h2>ProfileRegistry</h2>
      <p>
        On-chain user profiles with unique names (3&ndash;20 characters) and optional public self-reported audience
        context. Profile settings also support an on-chain generated avatar gradient seed override. RaterRegistry
        provides the optional identity and credential context used alongside public profile metadata.
      </p>
      <h3>Key Functions</h3>
      <ul>
        <li>
          <code>setProfile(name, selfReport)</code> &mdash; Create or update profile. Names are case-insensitive unique,
          and <code>selfReport</code> stores public, self-reported, unverified audience context.
        </li>
        <li>
          <code>getProfile(address)</code> &mdash; Get profile (name, selfReport, createdAt, updatedAt).
        </li>
        <li>
          <code>getAddressByName(name)</code> &mdash; Reverse lookup: name to owner address.
        </li>
        <li>
          <code>setAvatarAccent(rgb)</code> and <code>clearAvatarAccent()</code> &mdash; Set or remove the generated
          avatar gradient seed override.
        </li>
        <li>
          <code>getAvatarAccent(address)</code> &mdash; Read whether an avatar gradient seed override is set and the
          stored RGB value.
        </li>
      </ul>

      <hr />

      <h2>RateLoopGovernor</h2>
      <p>
        OpenZeppelin Governor with timelock control. Uses LREP voting power (ERC20Votes). Tokens are locked for 7 days
        when proposing or casting votes.
      </p>
      <div className="not-prose overflow-x-auto my-6 rounded-xl bg-base-200">
        <table className="table table-zebra [&_th]:text-base [&_td]:text-base [&_.badge]:text-base [&_th]:bg-base-300">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Voting delay</td>
              <td>~1 day (43,200 blocks on the 2s target-chain clock)</td>
            </tr>
            <tr>
              <td>Voting period</td>
              <td>~1 week (302,400 blocks on the 2s target-chain clock)</td>
            </tr>
            <tr>
              <td>Proposal threshold</td>
              <td>{protocolDocFacts.governanceProposalThresholdLabel}</td>
            </tr>
            <tr>
              <td>Quorum</td>
              <td>{protocolDocFacts.governanceQuorumLabel}</td>
            </tr>
            <tr>
              <td>Governance lock</td>
              <td>7 days transfer-locked (when proposing or voting)</td>
            </tr>
            <tr>
              <td>Voting delegation</td>
              <td>{protocolDocFacts.governanceVotingDelegationLabel}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <hr />

      <h2>Libraries</h2>
      <h3>RewardMath</h3>
      <ul>
        <li>
          RBTS score-spread settlement compares each revealed report&apos;s scoreBps with a leave-one-out benchmark from
          the other score-eligible revealed reports. Positive spreads receive full stake plus the 96% voter share of
          forfeited stake remaining after the settlement-caller incentive; negative spreads forfeit without a
          revealed-loser rebate. {protocolDocFacts.scoreSpreadForfeitPolicyLabel}
        </li>
        <li>
          <code>calculateVoterReward(shares, totalWinningShares, voterPool)</code> &mdash; Share-proportional reward
          from the content-specific pool. 100% of the voter share goes to the content-specific pool.
        </li>
        <li>
          <code>calculateRating(totalUpStake, totalDownStake)</code> &mdash; Legacy deployments use this smoothed
          stake-imbalance helper. The redeployed rating path uses <code>RatingMath.applySettlement</code> with
          cumulative bounded thumbs-up/down evidence, so the public score is the settled thumbs-up evidence share across
          all settled rounds.
        </li>
      </ul>
      <h3>RoundLib</h3>
      <p>
        Helpers for round state management: tracks round lifecycle (Open, Settled, Cancelled, Tied, RevealFailed) and
        settlement logic.
      </p>
    </article>
  );
};

export default SmartContracts;
