import { protocolDocFacts } from "./protocolFacts";

export const protocolCopy = {
  whyNowOverview:
    "Generative AI has made it cheap to produce convincing text, images, and video at scale. That weakens passive signals like likes, follower counts, and engagement.",
  strongerSignalOverview:
    "RateLoop offers a stronger signal: question-first submissions with a mandatory non-refundable bounty, a required context URL, optional preview media, and stake-weighted predicted ratings from open raters, recorded publicly and backed by economic risk.",
  predictionGamesOverview: `RateLoop replaces passive likes with question-first prediction rounds and a mandatory non-refundable bounty. Submissions start as a question and require a context URL; optional preview media can be attached when it helps discovery. The attached bounty is funded in LREP or USDC on World Chain and displayed to users in the funding asset, while raters predict the content's final 1.0-9.9 rating and back those predictions with LREP token stakes. Nearer revealed predictions win the content-specific rater pool: revealed misses can reclaim ${protocolDocFacts.revealedLoserRefundPercentLabel} of raw stake, and the remaining losing pool is split across accurate raters, frontend fees, consensus reserve, and treasury according to fixed on-chain percentages. There is no submitter upside path.`,
  contributorRewardsOverview: `After a ${protocolDocFacts.revealedLoserRefundPercentLabel} rebate for revealed misses, the remaining losing stake funds the content-specific rater pool plus frontend, consensus, and treasury shares. Bounties are attached at submission, funded in LREP or USDC on World Chain, remain non-refundable, and pay eligible revealed raters with a 3% commit-attributed frontend-operator share inside each qualified bounty round. People, bots, and AI agents submit through the same path when they want public feedback.`,
  feedbackBonusOverview:
    "Optional USDC Feedback Bonuses can reward revealed raters for hidden notes that make a question easier for agents to judge. Feedback stays off-chain, the app stores a canonical hash, and unawarded expired funds go to treasury.",
  roundSettingsOverview: `Question creators can choose per-question round settings for blind phase length, maximum round duration, settlement raters, and rater cap. Governance controls the default values and the allowed bounds (${protocolDocFacts.roundConfigBoundsSummaryLabel}), so fast high-bounty questions can ask for quicker answers while broader questions can wait for more raters.`,
  participationPoolPurpose:
    "Bootstraps early adoption -- calibration and rater bootstrap rewards become claimable after round settlement, and the rate halves based on cumulative LREP distributed from the pool.",
  participationPoolOverview:
    "The Bootstrap Pool solves the cold start problem. When the platform is new and stakes are small, round rewards alone may not be enough to attract raters. The Bootstrap Pool pays proportional LREP bonuses based on stake amount and prediction accuracy: accurate revealed raters claim bootstrap rewards after round settlement, and the reward rate is snapshotted at resolution time for fairness. Early participants receive the most thanks to a halving schedule as cumulative rewards grow and the reward rate decreases.",
  governanceOverview:
    "RateLoop is designed to finalize into a community-governed system. The governor/timelock owns upgrade, config, and treasury routing from launch, and the deployer renounces temporary setup roles after deployment finalization. Local or pre-finalization environments may still use temporary deployer wiring during setup.",
  governanceDesignPrinciple:
    "Finalized deployments keep treasury spending on the same on-chain governor/timelock path as upgrades and config, and temporary deployer setup roles are renounced after deployment finalization. Local or pre-finalization environments may still use temporary deployer wiring during setup.",
} as const;
