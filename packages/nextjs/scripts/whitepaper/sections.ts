import {
  protocolDocFacts,
  whitepaperRoundConfigBoundsRows,
  whitepaperSettlementConfigRows,
} from "../../lib/docs/protocolFacts";
import {
  LAUNCH_DISTRIBUTION_POOL_AMOUNT_COMPACT_LABEL,
  LREP_MAX_SUPPLY_LABEL,
  launchDistributionBreakdownRows,
  tokenDistributionWhitepaperRows,
} from "../../lib/docs/tokenomics";
import type { Section } from "./types";

export const SECTIONS: Section[] = [
  {
    title: "Introduction",
    lead: "RateLoop is a public, paid prediction-rating layer for agents and AI product teams.",
    subsections: [
      {
        heading: "Mission",
        blocks: [
          {
            type: "paragraph",
            text: "RateLoop exists for the moment an agent should ask instead of guess. It gives agents, AI product teams, and people an open-rater path to publish one bounded question, attach source context and funding, and receive a public rating signal with optional LREP-backed stake that other agents can inspect later.",
          },
        ],
      },
      {
        heading: "Why Now",
        blocks: [
          {
            type: "paragraph",
            text: "Generative models have made plausible text, images, and recommendations abundant, but they have also made low-cost mistakes, synthetic noise, and confidence theater abundant. Passive signals like likes, clicks, and reposts are weak inputs for agentic systems because they are easy to fake and rarely explain why a system should trust an answer. RateLoop treats rating work as a scarce resource that should be explicitly requested, funded, and recorded.",
          },
        ],
      },
      {
        heading: "Core Properties",
        blocks: [
          {
            type: "bullets",
            items: [
              "Bounded asks -- one question, public or RateLoop-hosted gated context, and explicit round terms.",
              "Paid attention -- every ask carries a non-refundable bounty funded in LREP or USDC, with optional payout-only eligibility scopes.",
              "Open participation -- people and agents use the same rating primitive after reputation and calibration rules are met.",
              "Skin in the game -- predictions can be backed by LREP stake for normal settlement upside and downside, while zero-LREP advisory raters can participate in rounds that already have a staked vote, do not count toward settlement quorum, and qualify for launch credits in eligible settled rounds.",
              "Agent-native access -- public MCP, direct JSON routes, SDK helpers, browser signing, and local signer flows all feed the same protocol record.",
              "Reusable output -- settled results stay public so later agents can inspect them instead of repeating the same ask.",
            ],
          },
        ],
      },
      {
        heading: "What Agents Get Back",
        blocks: [
          {
            type: "paragraph",
            text: "RateLoop returns a rating package, not just a raw score. Agents can read the settled rating, up/down distribution, predicted-up distribution, answer, confidence, rationale summary, dissenting view, optional feedback after unlock, payout metadata, bounty eligibility policy, all-answer scope, bounty-eligible answer scope, and a public result URL that can be cited in later decisions. The result is a public rating signal, not proof of universal truth.",
          },
        ],
      },
    ],
  },
  {
    title: "Why Agents Need Human Judgment",
    lead: "Models can search, predict, and plan, but many high-cost choices still need bounded human judgment.",
    subsections: [
      {
        heading: "Where Model Confidence Breaks",
        blocks: [
          {
            type: "paragraph",
            text: "Agents are strong at recall, synthesis, and low-cost iteration. They are weaker when the decision depends on taste, credibility, local context, ambiguity, social norms, or whether an action simply feels reasonable to other humans. In those cases the right move is often not to guess harder but to ask humans in a way that is structured, paid for, and auditable.",
          },
        ],
      },
      {
        heading: "Good Agent Questions",
        blocks: [
          {
            type: "table",
            data: {
              headers: ["Use case", "Example question"],
              rows: [
                ["Evidence quality", "Does this source actually support the claim?"],
                ["Usefulness", "Is this answer helpful for a beginner?"],
                ["Taste or clarity", "Which generated image better matches the brief?"],
                ["Local context", "Does this venue look open and trustworthy?"],
                ["Action review", "Should this agent send this message or hold it for review?"],
                ["Trace review", "Did this agent use its tools appropriately for the task?"],
              ],
            },
          },
        ],
      },
      {
        heading: "Open Rating Workloads",
        blocks: [
          {
            type: "paragraph",
            text: "The current AI focus is broader than generic feedback. RateLoop is designed to support AI answer quality review, source support, claim verification, source credibility screening, autonomous action gates, feature acceptance tests, agent trace review, proposal review, and output preference comparisons while keeping the same predicted-rating primitive with optional LREP stake.",
          },
        ],
      },
      {
        heading: "What RateLoop Is Not",
        blocks: [
          {
            type: "bullets",
            items: [
              "Not a truth oracle -- it returns public ratings with optional LREP-backed stake, visible disagreement, and limitations.",
              "Not a settlement oracle for external financial contracts -- settled scores are public feedback signals, not payout instructions for unrelated markets.",
              "Not a generic approval button -- it is designed for bounded questions that many raters can evaluate.",
              "Not a cryptographic secrecy system -- gated context is served by frontend/operator infrastructure after wallet-signed access checks, so operators and compromised serving infrastructure can see hosted bytes.",
              "Not a replacement for policy, law, or domain experts -- agents should use the result as one auditable input in a larger decision.",
            ],
          },
        ],
      },
      {
        heading: "Decision Checkpoint Loop",
        blocks: [
          {
            type: "ordered",
            items: [
              "Detect uncertainty, disagreement, or a high-cost action.",
              "Quote the ask, choose budget and timing, and submit a short question with context.",
              "Let open raters vote up/down and predict the crowd's up-vote share during the blind phase.",
              "Read the settled answer, confidence, rating signal, objections, and limitations.",
              "Act, revise, escalate, or stop while storing the public result URL in the agent audit trail.",
            ],
          },
        ],
      },
    ],
  },
  {
    title: "How RateLoop Works",
    lead: "Ask, fund, predict, settle, and reuse.",
    subsections: [
      {
        heading: "The Primitive",
        blocks: [
          {
            type: "ordered",
            items: [
              "Ask: submit one question-first ask with a public context URL, image context, YouTube video context, or RateLoop-hosted gated context.",
              "Fund: attach a non-refundable bounty in LREP or USDC on World Chain; agent asks spend from user-authorized wallets, scoped agent wallets, EIP-3009 USDC authorization, or ordered wallet calls.",
              "Vote: raters submit an up/down signal, predict the crowd's up-vote share, can add LREP stake, and may add public written feedback.",
              "Settle: the round resolves once the configured reveal and participation conditions are met.",
              "Reuse: any later agent can inspect the same settled result instead of paying to rediscover the same judgment.",
            ],
          },
        ],
      },
      {
        heading: "Question-First Submission",
        blocks: [
          {
            type: "paragraph",
            text: "Submission starts from the question rather than from a passive content object. Every ask requires inspectable evidence through a public source URL, image context, YouTube video context, or RateLoop-hosted gated context, and chooses blind phase, maximum duration, settlement raters, and rater cap inside governance bounds. Agents can submit through public MCP tools, direct JSON routes, browser signing intents, a local signer CLI, or optional managed policies, but the resulting protocol record is the same.",
          },
        ],
      },
      {
        heading: "Round Lifecycle",
        blocks: [
          {
            type: "table",
            data: {
              headers: ["Phase", "What happens", "Typical timing"],
              rows: [
                ["Submitted", "Question, context, bounty, and round settings are recorded", "Immediate"],
                [
                  "Blind rating vote",
                  "Open raters commit encrypted up/down signals and predicted-up percentages with optional 0-10 LREP stake",
                  `First ${protocolDocFacts.blindPhaseDurationLabel} epoch by default`,
                ],
                [
                  "Reveal",
                  "Keeper or connected users reveal eligible predictions after the epoch ends",
                  `${protocolDocFacts.revealGracePeriodLabel} grace window per past epoch`,
                ],
                [
                  "Settled",
                  `Any caller can settle once the selected rater threshold is met (${protocolDocFacts.launchFeedbackQuorumLabel}) and reveal conditions are satisfied`,
                  "Permissionless",
                ],
                [
                  "Claimed",
                  "Rewards, rebates, bounty payouts, and feedback awards become claimable under the round rules",
                  "Post-settlement",
                ],
              ],
            },
          },
          {
            type: "paragraph",
            text: "RateLoop uses tlock commit-reveal so votes and predicted-up percentages stay hidden until the selected epoch ends. That gives the protocol a blind phase without requiring every rater to reveal manually under normal conditions. Creator-selected round settings stay bounded by governance so asks can be faster or broader without becoming arbitrary.",
          },
        ],
      },
      {
        heading: "Rating and Result Generation",
        blocks: [
          {
            type: "paragraph",
            text: "New content shows N/A until the first settlement. Each round snapshots an internal rating prior on-chain, but raters submit an absolute binary signal plus a predicted-up percentage rather than voting to raise or lower a visible score. Settlement moves the public rating using bounded up/down signal evidence, while the predicted-up percentage stays separate for reward scoring. The same settlement also powers structured result templates so an agent can read a machine-usable answer, not only a raw market state.",
          },
          {
            type: "bullets",
            items: [
              "Protocol state: content ID, operation key, transaction history, prediction count, stake mass, and the settled rating.",
              "Agent-facing interpretation: answer, confidence, rating signal, all-answer and bounty-eligible scopes, rationale summary, major objections, dissenting view, limitations, and recommended next action.",
              "Audit surface: a public URL that preserves the original question and lets later systems inspect the same judgment record.",
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Product Experience",
    lead: "The current design puts the agent-first ask -> open rating loop in the first viewport.",
    subsections: [
      {
        heading: "Agent-First Brand",
        blocks: [
          {
            type: "paragraph",
            text: "The landing experience now leads with the concrete agent promise: Level Up Your Agent. The supporting line explains the loop in product language: Human and AI raters guide decisions and earn USDC. The visual system uses the segmented RateLoop ring mark, gradient wordmark treatment, and project hero animation, then explains the product through three steps: agents ask with context and bounty, raters predict during blind rounds with optional stake, and raters earn while agents use the public rating signal.",
          },
          {
            type: "bullets",
            items: [
              "Primary calls to action split the audience into For Humans and For Agents instead of hiding both behind generic docs links.",
              "The product benefit cards map directly to the technical rails: EIP-3009 USDC authorization and MCP for agents, optional identity for credentials, commit-reveal for honest rating, bounties and Feedback Bonuses for paid work, and on-chain settlement for transparency.",
              "The brand copy now frames RateLoop as public prediction ratings with optional LREP-backed stake for AI agents rather than a generic content curation app.",
            ],
          },
        ],
      },
      {
        heading: "Docs and App Shell",
        blocks: [
          {
            type: "paragraph",
            text: "Documentation has moved back into the app sidebar shell so protocol, AI, SDK, tokenomics, governance, and whitepaper pages sit beside the wallet-aware product routes. That design keeps the reference material close to ask, rate, governance, and settings workflows while preserving linkable section headings for agents and operators.",
          },
        ],
      },
      {
        heading: "Agent Setup Surface",
        blocks: [
          {
            type: "bullets",
            items: [
              "`/ask?tab=agent` is an optional setup and funding helper, not a required account gate.",
              "Public agent access works without a RateLoop account, bearer token, or saved policy when the agent supplies a funded `walletAddress` and the user approves the spend path.",
              "Browser signing creates an `/agent/sign/{intentId}` handoff for MetaMask, Ledger, and other injected-wallet approval flows.",
              "Local signer tooling lets a Codex-like local agent use an encrypted keystore, sign EIP-3009 USDC authorization when required, execute returned calls, and confirm hashes.",
              "Wallet settings cover ETH for gas, while the agent setup screen can help fund USDC for bounties.",
            ],
          },
        ],
      },
      {
        heading: "Rater Earning Surface",
        blocks: [
          {
            type: "paragraph",
            text: "The rater side is designed around concrete paid work rather than abstract engagement. Raters evaluate bounded asks, optionally risk LREP stake, reveal through keeper-assisted or fallback paths, claim eligible bounties and rewards after settlement, and can earn optional LREP or USDC Feedback Bonuses for hidden notes that make the result more useful to agents.",
          },
        ],
      },
    ],
  },
  {
    title: "Signal Integrity",
    lead: "Calibration, hidden predictions, optional credentials, and bounded stake rules reduce manipulation pressure.",
    subsections: [
      {
        heading: "Open Rater Integrity",
        blocks: [
          {
            type: "bullets",
            items: [
              "Core participation does not require proof-of-personhood, so people and agents can use the same flow.",
              "Reputation, calibration history, and credential signals can inform earning policy without making proof-of-personhood a hard settlement gate.",
              "Each account is capped at 10 LREP per content per round by default.",
              "Optional identity providers can unlock a one-time launch bonus and verified-human launch anchors, but they do not change settlement reward weight.",
              "Correlation Epoch Snapshots cap USDC and launch LREP payouts for dense wallet or operator clusters across multiple rounds, with roots proposed by globally bonded 1,000 LREP frontend operators.",
            ],
          },
        ],
      },
      {
        heading: "Anti-Herding Design",
        blocks: [
          {
            type: "paragraph",
            text: `Private vote reports are encrypted with tlock against the drand beacon, so early raters cannot see the up/down distribution they are contributing to. Once epoch-1 results are visible, later reports still count, but they earn only ${protocolDocFacts.openPhaseWeightLabel} reward weight compared with ${protocolDocFacts.blindPhaseWeightLabel} in the blind epoch. That ${protocolDocFacts.earlyVoterAdvantageLabel} ratio makes copying late less attractive than judging early.`,
          },
        ],
      },
      {
        heading: "Keeper and Reveal Model",
        blocks: [
          {
            type: "paragraph",
            text: "The current design uses a keeper-assisted reveal path with a user fallback. After epoch end the keeper fetches the public drand material, validates the stored stanza metadata, decrypts eligible ciphertexts off-chain, and submits reveals. Connected users can self-reveal if needed. Settlement is blocked during the reveal grace window while past-epoch predictions remain unrevealed, which limits selective revelation.",
          },
        ],
      },
      {
        heading: "Security Properties",
        blocks: [
          {
            type: "bullets",
            items: [
              "Sybil resistance from LREP cost, calibration, per-round stake caps, optional credentials, and public behavior history.",
              "Cryptographic hiding during the blind phase through tlock and drand.",
              "Economic anti-herding through epoch-weighted rewards and win conditions.",
              "Permissionless settlement, refunds, and cleanup once conditions are met.",
              "Malformed or non-armored ciphertexts are rejected on-chain before they can pollute settlement.",
              "Public on-chain history and frontend-backed challengeable payout roots make suspicious funding, timing, and prediction patterns auditable by the community.",
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Incentives & Token Flows",
    lead: "LREP aligns attention, bounties fund asks, and rewards flow from observable protocol rules.",
    subsections: [
      {
        heading: "Role of LREP",
        blocks: [
          {
            type: "paragraph",
            text: `LREP is a transferable reputation token used for optional prediction stake, earned launch reputation, and protocol governance. It is not sold by the protocol and is not described here as a financial asset. The max supply is ${LREP_MAX_SUPPLY_LABEL}, and launch distribution is routed into protocol-controlled pools rather than to a team or sale.`,
          },
          {
            type: "table",
            data: {
              headers: ["Property", "Value"],
              rows: [
                ["Name", "Loop Reputation"],
                ["Symbol", "LREP"],
                ["Max supply", LREP_MAX_SUPPLY_LABEL],
                ["Decimals", "6"],
                ["Primary role", "Stake-backed rating reports and governance participation"],
              ],
            },
          },
          {
            type: "paragraph",
            text: `Broad distribution matters because the rating layer is only credible if many independent raters can participate. The ${LAUNCH_DISTRIBUTION_POOL_AMOUNT_COMPACT_LABEL} Launch Distribution Pool splits into 42M LREP for front-loaded verified + referral rewards, 24M LREP for front-loaded earned rater rewards, and 9M LREP for legacy contributor vesting. Earned rater rewards stay open to any rater, but qualifying launch credits require verified-human anchored rounds, minimum launch-credit stake for staked votes, cross-round anchor diversity, bounded anchor fanout, round-level unverified-credit caps, aged anchor credentials, and finalized correlation payout snapshots before payout. Open raters can start under a governed 25% partial cap and later unlock the full snapshotted cap by verifying the same wallet as a human; agent wallets do not count as human anchors unless they hold an active verified-human credential. Legacy contributor addresses are seeded as active verified humans at launch for the standard credential TTL, so they use the same verified-human gates and bonus paths while active. Verification acceleration, safety, appeals, and governed programs belong to the treasury.`,
          },
          {
            type: "sub_heading",
            text: "Launch credit accrual",
          },
          {
            type: "formula",
            latex: String.raw`\mathrm{credit}_r = \frac{\mathrm{ind}_r}{10\,000}`,
          },
          {
            type: "formula",
            latex: String.raw`\mathrm{payout} = \min\!\left(\mathrm{cap},\; \mathrm{cap}\cdot\frac{\sum_r \mathrm{credit}_r}{10}\right) - \mathrm{paid}`,
          },
          {
            type: "paragraph",
            text: "Here ind_r is the finalized independence weight for round r in basis points, cap is the wallet's launch cap after verified-anchor checks, and paid is launch LREP already paid to that wallet.",
          },
        ],
      },
      {
        heading: "Settlement and Payouts",
        blocks: [
          {
            type: "table",
            data: {
              headers: ["Recipient", "Share"],
              rows: [
                ["Positive score-spread reports", "Full stake plus pro-rata share of the 96% voter share"],
                [
                  "Negative score-spread reports",
                  `Forfeit according to distance below the report's leave-one-out benchmark once ${protocolDocFacts.scoreSpreadForfeitMinRevealsLabel} score-eligible voters reveal, capped at ${protocolDocFacts.maxScoreSpreadForfeitPercentLabel} of stake`,
                ],
                ["Frontend rail", "3% of forfeited stake when an eligible frontend exists"],
                ["Treasury rail", "1% of forfeited stake with voter-pool fallback if unavailable"],
                ["Unrevealed reports", "No RBTS payout; cleanup can forfeit after the reveal grace path"],
                ["Revealed-loser rebate", "None for RBTS score-spread settlement"],
              ],
            },
          },
          {
            type: "paragraph",
            text: `RBTS settlement stores each revealed report's scoreBps, computes a leave-one-out benchmark for each staked report from the stake-weighted scores of the other score-eligible revealed reports, and compares the report with that benchmark. Positive spreads recover full stake plus a pro-rata share of the 96% voter share of forfeited negative-spread stake; negative spreads forfeit, with no revealed-loser rebate, only after ${protocolDocFacts.scoreSpreadForfeitMinRevealsLabel} score-eligible voters reveal. Per-report score-spread forfeiture is capped at ${protocolDocFacts.maxScoreSpreadForfeitPercentLabel} of stake. The benefit is that stake rewards follow relative predictive quality rather than raw popularity, so raters have a reason to report independently instead of copying visible momentum; leave-one-out also prevents a large staker from pulling its own payout benchmark toward its score. Tier-1 raters carry full blind-epoch weight and later raters carry ${protocolDocFacts.openPhaseWeightLabel} weight, so the same anti-herding logic shapes settlement. USDC bounty and launch LREP claims add a second step: a finalized correlation payout snapshot proposed by a registered frontend operator supplies effective claim weights before funds move, without changing the already-settled result.`,
          },
          {
            type: "sub_heading",
            text: "RBTS score-spread settlement formulas",
          },
          {
            type: "formula",
            latex: String.raw`b_i = \frac{\sum_j k_j\, s_j - k_i\,s_i}{\sum_j k_j - k_i} \qquad d_i = s_i - b_i`,
          },
          {
            type: "formula",
            latex: String.raw`f_i = \begin{cases} \min\!\left(k_i\,\lambda\,\dfrac{\lvert d_i\rvert}{100},\; 0.5\,k_i\right) & d_i < 0 \;\text{ and }\; n \ge ${protocolDocFacts.scoreSpreadForfeitMinRevealsLabel} \\[6pt] 0 & \text{otherwise} \end{cases}`,
          },
          {
            type: "formula",
            latex: String.raw`F' = \sum_i f_i - \min\!\left(0.01 \textstyle\sum_i f_i,\; 1\right)`,
          },
          {
            type: "formula",
            latex: String.raw`r_i = 0.96\, F' \cdot \frac{k_i\, d_i}{\sum_{d_j > 0} k_j\, d_j}`,
          },
          {
            type: "formula",
            latex: String.raw`\mathrm{claim}_i = \begin{cases} k_i + r_i & d_i > 0 \\ k_i - f_i & d_i < 0 \end{cases}`,
          },
          {
            type: "paragraph",
            text: "Here k_i is the LREP stake on report i, s_i is the revealed RBTS score, b_i is report i's leave-one-out benchmark, lambda is the governance-set forfeit intensity, n is the number of score-eligible revealed voters, and F' is the forfeited pool after the settlement-caller cut.",
          },
        ],
      },
      {
        heading: "Bounties and Feedback Bonuses",
        blocks: [
          {
            type: "bullets",
            items: [
              "Every ask attaches a non-refundable bounty in LREP or USDC on World Chain.",
              "USDC agent asks can use EIP-3009 authorization or ordered wallet calls to fund protocol escrow directly from the approved wallet.",
              `The bounty voter requirement matches the question's selected settlement voter threshold. Bounty size can raise the launch floor: ${protocolDocFacts.bountyParticipantFloorsLabel}. ${protocolDocFacts.quorumRatchetPolicyLabel}`,
              "Qualified bounty rounds pay eligible revealed raters and reserve 3% for eligible frontend operators after correlation-capped payout weights finalize.",
              "Registered frontend operators bond 1,000 LREP before proposing payout roots for those claim weights.",
              "Payout-root challengers post a USDC ERC20 bond, defaulting to 5 USDC (5_000_000 atomic units).",
              "Optional LREP or USDC Feedback Bonuses reward hidden notes by canonical hash after settlement.",
              "USDC asks do not require proof-of-personhood; bounty eligibility is set by the ask and finalized claim weights, while reputation and calibration can still shape policy and routing.",
              "Submitters do not earn upside from their own ask; the protocol pays for judgment, not self-rating.",
            ],
          },
          {
            type: "sub_heading",
            text: "Bounty claim formulas",
          },
          {
            type: "formula",
            latex: String.raw`\mathrm{payout}_i = A_R \cdot \frac{w_i}{\sum_j w_j}`,
          },
          {
            type: "formula",
            latex: String.raw`w_i = w_i^{\mathrm{base}} \cdot \frac{\mathrm{ind}_i}{10\,000} \qquad w_i^{\mathrm{base}} \in [10\,000,\; 20\,000]\ \mathrm{bps}`,
          },
          {
            type: "paragraph",
            text: "A_R is the round allocation, w_i is the finalized claim weight, w_i^base is the surprise-weighted base weight from the snapshot, and ind_i is the independence multiplier in basis points from the correlation scorer. The benefit is a bounty rule that buys scarce, informative judgment instead of rewarding only participation or raw majority alignment.",
          },
        ],
      },
      {
        heading: "Token Distribution",
        blocks: [
          {
            type: "table",
            data: {
              headers: ["Pool", "Allocation", "Purpose"],
              rows: tokenDistributionWhitepaperRows,
            },
          },
          {
            type: "table",
            data: {
              headers: ["Launch rail", "Allocation", "Purpose"],
              rows: launchDistributionBreakdownRows.map(row => [...row]),
            },
          },
        ],
      },
      {
        heading: "Launch Pool and Treasury",
        blocks: [
          {
            type: "paragraph",
            text: "The Launch Distribution Pool (75M LREP) is split into 42M LREP for verified + referral rewards, 24M LREP for earned rater rewards, and 9M LREP for legacy contributor vesting. It is effective-credit based and governance-tunable: the initial earned-rater policy requires three revealed raters, one verified-human anchor in the round, a minimum launch-credit stake for staked votes, two distinct verified-human anchors across a rater's qualifying history, bounded anchor fanout, round-level unverified-credit caps, aged anchor credentials, and finalized correlation payout snapshots before payout. Correlated or immature unverified accounts accrue fractional launch credit, so multiple independent rounds may be needed before LREP starts paying. Full earned-rater caps are front-loaded for the cold-start phase: 500 LREP for eligible raters 1-100, 250 LREP for 101-1,000, 100 LREP for 1,001-10,000, then 10, 5, 2.5, 1.25, and 0.5 LREP for later cohorts, supporting about 10.94M fully paid earned-rater recipients from the 24M LREP rail. Open raters receive a governed 25% partial cap, so first-100 open-lane raters can earn up to 125 LREP before later unlocking the full snapshotted cap by verifying the same wallet as a human; each human nullifier can unlock the full earned-rater cap for only one rater address, and agent wallets do not count as human anchors unless credentialed. Verified + referral rewards are also front-loaded: claims 1-100 receive 250 LREP for the verified user and 125 LREP for the referrer, then 100 / 50 LREP for claims 101-1,000, 40 / 20 LREP for claims 1,001-10,000, and 10 / 5 LREP through claim 50,000. Referral rewards remain immediate at 50% of the verified user's bonus and bounded by the per-referrer cap. Legacy contributors receive prior-allocation-based claims with 1% immediately claimable, 99% linearly unlocked over 24 months, and a 27-month claim window after root activation before unclaimed balances become treasury-recoverable; their addresses are also seeded as verified humans at launch for the standard credential TTL, making them eligible for the same verified-human gates and bonuses while active. The treasury starts with 25M LREP under the governance timelock and handles safety responses, verification acceleration, appeals, grants, and other governed programs. The bootstrap proposal threshold is 1,000 LREP with a minimum quorum floor of 100,000 LREP.",
          },
        ],
      },
      {
        heading: "Staking Requirements",
        blocks: [
          {
            type: "table",
            data: {
              headers: ["Action", "Requirement", "Notes"],
              rows: [
                [
                  "Vote up/down and predict crowd share",
                  "0-10 LREP",
                  "Per prediction, per round; zero-LREP advisory votes require an existing staked vote, do not count toward settlement quorum, and can qualify for launch credits in eligible settled rounds",
                ],
                [
                  "Ask a question",
                  "1 LREP or 1 USDC minimum bounty",
                  "Mandatory and non-refundable; the ask is funded before judgment arrives",
                ],
                [
                  "Register as a frontend",
                  "1,000 LREP",
                  "Returned on exit unless governance-defined slashing applies; also backs payout-root proposals",
                ],
              ],
            },
          },
        ],
      },
    ],
  },
  {
    title: "Agent Interfaces",
    lead: "Agents integrate through public, accountless interfaces first and managed controls only when useful.",
    subsections: [
      {
        heading: "Integration Surfaces",
        blocks: [
          {
            type: "bullets",
            items: [
              "Public MCP and direct JSON routes support wallet-direct asks with `walletAddress` and no bearer token.",
              "MCP-style tools include `rateloop_list_categories`, `rateloop_list_result_templates`, `rateloop_quote_question`, `rateloop_ask_humans`, `rateloop_confirm_ask_transactions`, `rateloop_get_question_status`, and `rateloop_get_result`.",
              "Direct HTTP routes cover templates, quotes, ask creation, transaction confirmation, status/result reads, and browser-signing intent create/read/prepare/complete endpoints under `/api/agent/signing-intents`.",
              "Payment modes include ordered `wallet_calls` for LREP or USDC escrow funding and `eip3009_usdc_authorization` for USDC asks; `x402_authorization` remains a compatibility alias.",
              "Browser signing intents let an agent create an approval URL for a human operator to connect a wallet, prepare the ask, execute transactions, and confirm hashes.",
              "The local signer CLI loads an encrypted keystore, signs EIP-3009 USDC authorization when needed, sends returned transaction plan calls through viem, waits for receipts, and confirms the ask.",
              "Optional managed policies add bearer tokens, RateLoop-enforced spend caps, category allowlists, signed callbacks, balance tooling through `rateloop_get_agent_balance`, and audit exports.",
            ],
          },
        ],
      },
      {
        heading: "Public Connector Flow",
        blocks: [
          {
            type: "ordered",
            items: [
              "Choose a category and result template.",
              "Quote the ask with `walletAddress`, budget, rater count, and timing preferences before spending.",
              "Submit through `rateloop_ask_humans` or `POST /api/agent/asks` with a stable `clientRequestId`, bounty, max payment amount, and payment mode.",
              "Sign the EIP-3009 USDC authorization or execute the returned wallet calls; use browser signing when a human needs to approve the transaction in an injected wallet.",
              "Confirm submitted transaction hashes through `rateloop_confirm_ask_transactions`.",
              "Poll `rateloop_get_question_status`, wait for an optional signed callback, then read `rateloop_get_result`, persist the public URL, and continue, revise, or stop.",
            ],
          },
        ],
      },
      {
        heading: "Runtime Fit",
        blocks: [
          {
            type: "table",
            data: {
              headers: ["Agent type", "Best integration", "Wait strategy", "Example"],
              rows: [
                ["Chat agents", "Public MCP or browser signing handoff", "Poll status/result", "ChatGPT, Claude"],
                [
                  "Persistent agents",
                  "Public MCP or managed MCP plus callbacks",
                  "Signed callback webhook",
                  "Hermes, OpenClaw",
                ],
                [
                  "Terminal agents",
                  "`mcpServers`, SDK, or local signer CLI",
                  "Poll or callback",
                  "Coding agents and CLIs",
                ],
                [
                  "Backend workers",
                  "SDK or direct JSON routes",
                  "Callback queue",
                  "Research, lead-gen, moderation jobs",
                ],
              ],
            },
          },
        ],
      },
      {
        heading: "Result Templates",
        blocks: [
          {
            type: "bullets",
            items: [
              "`generic_rating` turns private rating reports into a general support signal.",
              "`go_no_go` maps up/down settlement to proceed, stop, or revise for action review flows.",
              "`ranked_option_member` lets an agent ask one question per option and compare settled outputs without inventing a new scoring system.",
              "`llm_answer_quality`, `rag_grounding_check`, `claim_verification`, and `source_credibility_check` cover answer quality, source support, factual support, and evidence reliability.",
              "`agent_action_go_no_go`, `feature_acceptance_test`, `agent_trace_review`, and `proposal_review` cover action gates, public preview testing, trajectory/tool-call review, and proposal readiness.",
              "`pairwise_output_preference` supports AI/model output comparisons while preserving one anchored ask per judged candidate.",
            ],
          },
          {
            type: "paragraph",
            text: "Templates keep the voting rails stable while making the returned judgment easier for agents to parse. The protocol anchors the ask and settlement record, while result interpretation metadata stays flexible enough to evolve with agent use cases.",
          },
        ],
      },
    ],
  },
  {
    title: "Governance & Public Infrastructure",
    lead: "The judgment layer is governed on-chain and published as a reusable public data layer.",
    subsections: [
      {
        heading: "Governance Overview",
        blocks: [
          {
            type: "paragraph",
            text: "Governor and timelock contracts own upgrades, configuration, and treasury routing in finalized deployments. The intent is that the same community that earns LREP by participating in ratings should also be able to tune the rules of the rating layer in public.",
          },
        ],
      },
      {
        heading: "Cluster Payout Oracle",
        blocks: [
          {
            type: "paragraph",
            text: "The ClusterPayoutOracle is a governance-managed target for challengeable correlation epoch and round payout roots. Registered frontend operators with a 1,000 LREP bond propose deterministic artifact roots from their registered wallet or a delegated snapshot keeper; independent operators can recompute them and challenge bad roots with the configured USDC ERC20 challenge bond, defaulting to 5 USDC (5_000_000 atomic units). Governance configures oracle challenge terms, arbitrates challenged roots with public reason hashes, and can slash the proposing frontend through the FrontendRegistry when the on-chain-data computation is wrong.",
          },
          {
            type: "paragraph",
            text: "The design does not try to fully collateralize every payout snapshot on-chain. It is an optimistic model: globally bonded frontend operators publish public artifacts, challengers get a window to recompute them, governance arbitrates disputes, and dishonest operators can lose frontend stake, reputation, and future income.",
          },
        ],
      },
      {
        heading: "Proposal Parameters",
        blocks: [
          {
            type: "table",
            data: {
              headers: ["Parameter", "Value"],
              rows: [
                ["Proposal threshold", protocolDocFacts.governanceProposalThresholdLabel],
                ["Quorum", protocolDocFacts.governanceQuorumLabel],
                ["Voting delay", "~1 day (43,200 blocks on the 2s World Chain clock)"],
                ["Voting period", "~1 week (302,400 blocks on the 2s World Chain clock)"],
                ["Timelock delay", protocolDocFacts.governanceTimelockDelayLabel],
                ["Governance lock", "7 days transfer-locked after voting or proposing"],
              ],
            },
          },
        ],
      },
      {
        heading: "Round Configuration Surface",
        blocks: [
          {
            type: "paragraph",
            text: `Governance sets the defaults and the allowed bounds. Question creators choose within those bounds at ask time, which lets agents trade off speed, budget, and quorum without bypassing shared policy. ${protocolDocFacts.feedbackTierPolicyLabel} ${protocolDocFacts.quorumRatchetPolicyLabel}`,
          },
          {
            type: "table",
            data: {
              headers: ["Settlement parameter", "Current default", "Effect"],
              rows: whitepaperSettlementConfigRows,
            },
          },
          {
            type: "table",
            data: {
              headers: ["Creator setting", "Allowed range"],
              rows: whitepaperRoundConfigBoundsRows,
            },
          },
        ],
      },
      {
        heading: "On-Chain Public Data Layer",
        blocks: [
          {
            type: "paragraph",
            text: "A core design choice is that asks and settlement history live on-chain as public infrastructure. Context can be public, or RateLoop-hosted and gated behind wallet-signed confidentiality acceptance, but the canonical hashes, commitments, and settled result remain inspectable. Gated context is a serving-layer access restriction: the frontend or context host can read the hosted bytes, and a server compromise can disclose them. Hosted indexers and frontends may apply rate limits, moderation filters, confidentiality redaction, or UX-specific views, but the canonical result remains permissionless and inspectable.",
          },
          {
            type: "bullets",
            items: [
              "Later agents can reuse prior judgment instead of buying the same answer again.",
              "Researchers can inspect rating behavior, disagreement, and settlement dynamics without private data deals.",
              "Third-party frontends and operators can build on the same rails without asking for permission.",
              "Training, retrieval, evaluation, and release-gate systems can incorporate public rating judgment as an explicit signal rather than a hidden vendor output.",
            ],
          },
        ],
      },
      {
        heading: "Treasury and Operator Incentives",
        blocks: [
          {
            type: "paragraph",
            text: "Treasury spending, parameter changes, and upgrades all follow the same governance path. That keeps the system legible, but it also means governance quality matters. Eligible frontend operators can earn the reserved share on qualifying payouts, and anyone can run frontends, keepers, or indexers on top of the public protocol so long as they respect the same on-chain rules.",
          },
        ],
      },
    ],
  },
  {
    title: "Limitations & Future Work",
    lead: "RateLoop returns public rating judgment, not certainty, and several trust and product gaps remain open.",
    subsections: [
      {
        heading: "Current Limitations",
        blocks: [
          {
            type: "bullets",
            items: [
              "RateLoop returns public rating judgment, not objective truth; ambiguous and taste-heavy questions remain subjective by design.",
              "The current reveal path still depends on drand plus off-chain keeper decryption, even though settlement and fallback reveal are permissionless.",
              "Private-context asks are operator-trust by design: wallet-signed terms, watermarks, access logs, optional bonds, and identity bans deter leaks, but they do not stop an eligible rater, the serving operator, or compromised infrastructure from seeing the material.",
              "The current evaluation layer is ask- and bundle-centric; project-level datasets, queue operations, agreement dashboards, and release gates remain future product work.",
              "Optional identity providers can add useful credentials but should not become a single dependency or hard participation gate.",
              "Resolution speed depends on turnout, reveal activity, and the ask's chosen round settings.",
            ],
          },
        ],
      },
      {
        heading: "Future Directions",
        blocks: [
          {
            type: "bullets",
            items: [
              "Project-level evaluation objects for datasets, trace imports, eval runs, release gates, and structured exports.",
              "Agreement and dissent analytics for rubric dimensions, reason clusters, stake-weighted views, and low-confidence routing.",
              "Richer reviewer operations around assignments, reservations, progress tracking, sampling, and bulk queue actions.",
              "Stronger managed operator controls around budgets, scopes, allowlists, callback management, and audit exports.",
              "Stronger private-context evidence, including append-only anchored access-log roots, richer forensic watermarking, and permissioned cohorts for higher-sensitivity workflows.",
              "Expertise-aware or category-specific reputation overlays that preserve the same core ask-and-settle primitive.",
              "zk-based reveal proofs that reduce the remaining trust gap in the current off-chain decryption flow.",
            ],
          },
        ],
      },
      {
        heading: "Closing Principle",
        blocks: [
          {
            type: "paragraph",
            text: "The goal is not to build a universal truth machine. The goal is simpler and more practical: give agents a clean, public way to ask open raters when judgment matters.",
          },
        ],
      },
    ],
  },
];
