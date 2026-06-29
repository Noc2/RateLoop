import { index, onchainTable, relations, sql } from "ponder";

// ============================================================
// CONTENT
// ============================================================

export const content = onchainTable(
  "content",
  (t) => ({
    id: t.bigint().primaryKey(),
    submitter: t.hex().notNull(),
    submitterIdentity: t.hex(),
    submitterIdentityKey: t.hex(),
    contentHash: t.hex().notNull(),
    questionMetadataHash: t.hex(),
    questionMetadata: t.text(),
    questionMetadataUri: t.text(),
    resultSpecHash: t.hex(),
    gated: t.boolean().notNull().default(false),
    confidentialityDisclosurePolicy: t.text(),
    confidentialityBondAsset: t.text(),
    confidentialityBondAmount: t.bigint().notNull().default(0n),
    confidentialityPublishedAt: t.bigint(),
    targetAudience: t.text(),
    targetAudienceAgeGroups: t.text(),
    targetAudienceCountries: t.text(),
    targetAudienceExpertise: t.text(),
    targetAudienceLanguages: t.text(),
    targetAudienceNationalities: t.text(),
    targetAudienceRoles: t.text(),
    targetAudienceAiAgentFrameworks: t.text(),
    targetAudienceAiAutonomy: t.text(),
    targetAudienceAiExpertise: t.text(),
    targetAudienceAiLanguages: t.text(),
    targetAudienceAiModelProviders: t.text(),
    targetAudienceTeamCountries: t.text(),
    targetAudienceTeamExpertise: t.text(),
    targetAudienceTeamLanguages: t.text(),
    targetAudienceTeamSizes: t.text(),
    targetAudienceTeamTypes: t.text(),
    targetAudienceHybridExpertise: t.text(),
    targetAudienceHybridLanguages: t.text(),
    targetAudienceHybridModelProviders: t.text(),
    targetAudienceHybridOversight: t.text(),
    detailsUrl: t.text(),
    detailsHash: t.hex(),
    url: t.text().notNull(),
    canonicalUrl: t.text().notNull(),
    urlHost: t.text().notNull(),
    title: t.text().notNull(),
    description: t.text().notNull(),
    tags: t.text().notNull(),
    categoryId: t.bigint().notNull(),
    status: t.integer().notNull(), // 0=Active, 1=Dormant, 2=Cancelled
    rating: t.integer().notNull(), // 0-100, starts at 50
    ratingBps: t.integer().notNull(), // 0-10000, starts at 5000
    conservativeRatingBps: t.integer().notNull(),
    ratingConfidenceMass: t.bigint().notNull(),
    ratingEffectiveEvidence: t.bigint().notNull(),
    ratingUpEvidence: t.bigint().notNull(),
    ratingDownEvidence: t.bigint().notNull(),
    ratingSettledRounds: t.integer().notNull(),
    ratingLowSince: t.bigint().notNull(),
    ratingReviewStatus: t.integer().notNull().default(0),
    ratingReviewRoundId: t.bigint(),
    ratingReviewUpdatedAt: t.bigint(),
    createdAt: t.bigint().notNull(),
    lastActivityAt: t.bigint().notNull(),
    totalVotes: t.integer().notNull(),
    totalRounds: t.integer().notNull(),
    roundEpochDuration: t.integer().notNull().default(1200),
    roundMaxDuration: t.integer().notNull().default(1200),
    roundMinVoters: t.integer().notNull().default(3),
    roundMaxVoters: t.integer().notNull().default(100),
    bundleId: t.bigint(),
    bundleIndex: t.integer(),
  }),
  (table) => ({
    submitterIdx: index().on(table.submitter),
    submitterIdentityIdx: index().on(table.submitterIdentity),
    submitterIdentityKeyIdx: index().on(table.submitterIdentityKey),
    categoryIdx: index().on(table.categoryId),
    bundleIdx: index().on(table.bundleId),
    targetAudienceAgeGroupsIdx: index().on(table.targetAudienceAgeGroups),
    targetAudienceCountriesIdx: index().on(table.targetAudienceCountries),
    targetAudienceExpertiseIdx: index().on(table.targetAudienceExpertise),
    targetAudienceLanguagesIdx: index().on(table.targetAudienceLanguages),
    targetAudienceNationalitiesIdx: index().on(
      table.targetAudienceNationalities,
    ),
    targetAudienceRolesIdx: index().on(table.targetAudienceRoles),
    questionMetadataHashIdx: index().on(table.questionMetadataHash),
    resultSpecHashIdx: index().on(table.resultSpecHash),
    canonicalUrlIdx: index().on(table.canonicalUrl),
    urlHostIdx: index().on(table.urlHost),
    statusIdx: index().on(table.status),
    statusLastActivityIdx: index().on(table.status, table.lastActivityAt),
    ratingIdx: index().on(table.rating),
    createdAtIdx: index().on(table.createdAt),
    searchIdx: index("content_search_idx").using(
      "gin",
      sql`(
        setweight(to_tsvector('simple', coalesce(${table.title}, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(${table.tags}, '')), 'B') ||
        setweight(
          to_tsvector(
            'simple',
            case
              when ${table.gated} = true and ${table.confidentialityPublishedAt} is null then ''
              else coalesce(${table.description}, '')
            end
          ),
          'C'
        )
      )`,
    ),
  }),
);

export const contentRelations = relations(content, ({ many, one }) => ({
  rounds: many(round),
  media: many(contentMedia),
  category: one(category, {
    fields: [content.categoryId],
    references: [category.id],
  }),
}));

export const contentMedia = onchainTable(
  "content_media",
  (t) => ({
    id: t.text().primaryKey(), // `${contentId}-${mediaIndex}`
    contentId: t.bigint().notNull(),
    mediaIndex: t.integer().notNull(),
    mediaType: t.text().notNull(), // "image" or "video"
    url: t.text().notNull(),
    canonicalUrl: t.text().notNull(),
    urlHost: t.text().notNull(),
  }),
  (table) => ({
    contentIdx: index().on(table.contentId),
    contentIndexIdx: index().on(table.contentId, table.mediaIndex),
    canonicalUrlIdx: index().on(table.canonicalUrl),
    urlHostIdx: index().on(table.urlHost),
  }),
);

export const contentMediaRelations = relations(contentMedia, ({ one }) => ({
  contentRef: one(content, {
    fields: [contentMedia.contentId],
    references: [content.id],
  }),
}));

// ============================================================
// ROUND (per content per round)
// ============================================================

export const round = onchainTable(
  "round",
  (t) => ({
    id: t.text().primaryKey(), // `${contentId}-${roundId}`
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    state: t.integer().notNull(), // 0=Open, 1=Settled, 2=Cancelled, 3=Tied, 4=RevealFailed
    voteCount: t.integer().notNull(), // total commits
    revealedCount: t.integer().notNull().default(0), // revealed votes
    totalStake: t.bigint().notNull(),
    upPool: t.bigint().notNull(), // raw UP stake (from revealed votes)
    downPool: t.bigint().notNull(), // raw DOWN stake (from revealed votes)
    upCount: t.integer().notNull(),
    downCount: t.integer().notNull(),
    referenceRatingBps: t.integer().notNull(),
    ratingBps: t.integer().notNull(),
    conservativeRatingBps: t.integer().notNull(),
    confidenceMass: t.bigint().notNull(),
    effectiveEvidence: t.bigint().notNull(),
    upEvidence: t.bigint().notNull(),
    downEvidence: t.bigint().notNull(),
    settledRounds: t.integer().notNull(),
    lowSince: t.bigint().notNull(),
    ratingReviewStatus: t.integer().notNull().default(0),
    ratingReviewReferenceRatingBps: t.integer(),
    ratingReviewRawUpEvidence: t.bigint(),
    ratingReviewRawDownEvidence: t.bigint(),
    ratingReviewSnapshotDigest: t.hex(),
    ratingReviewUpdatedAt: t.bigint(),
    epochDuration: t.integer().notNull().default(1200),
    maxDuration: t.integer().notNull().default(1200),
    minVoters: t.integer().notNull().default(3),
    maxVoters: t.integer().notNull().default(100),
    upWins: t.boolean(),
    losingPool: t.bigint(),
    rbtsRewardWeight: t.bigint(),
    rbtsRewardClaimants: t.integer(),
    rbtsScoreSeed: t.hex(),
    rbtsMeanScoreBps: t.integer(),
    rbtsForfeitedPool: t.bigint(),
    rbtsForfeitClaimants: t.integer(),
    startTime: t.bigint(),
    settledAt: t.bigint(),
    hasHumanVerifiedCommit: t.boolean().notNull().default(false),
    humanVerifiedCommitCount: t.integer().notNull().default(0),
    lastCommitRevealableAfter: t.bigint(),
    revealGracePeriod: t.bigint(),
  }),
  (table) => ({
    contentIdx: index().on(table.contentId),
    roundIdx: index().on(table.roundId),
    stateIdx: index().on(table.state),
    stateContentRoundIdx: index().on(
      table.state,
      table.contentId,
      table.roundId,
    ),
    settledAtIdx: index().on(table.settledAt),
  }),
);

export const roundRelations = relations(round, ({ many, one }) => ({
  contentRef: one(content, {
    fields: [round.contentId],
    references: [content.id],
  }),
  votes: many(vote),
}));

// ============================================================
// VOTE (tlock commit-reveal votes)
// ============================================================

export const vote = onchainTable(
  "vote",
  (t) => ({
    id: t.text().primaryKey(), // `${contentId}-${roundId}-${voter}` where voter is the raw commit address
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    voter: t.hex().notNull(), // raw commit/stake-payer address
    identityKey: t.hex(), // resolved RaterRegistry identity key at commit time, when available
    identityHolder: t.hex(), // resolved RaterRegistry holder at commit time, or voter when unavailable
    credentialMask: t.integer().notNull().default(0), // active World ID credential kinds at commit time
    freshCredentialMask: t.integer().notNull().default(0), // recent user-presence rechecks at commit time
    commitKey: t.hex().notNull(),
    commitHash: t.hex().notNull(),
    ciphertextHash: t.hex().notNull(),
    ciphertext: t.hex().notNull(),
    ciphertextSource: t.text().notNull().default("event"),
    targetRound: t.bigint().notNull(),
    drandChainHash: t.hex().notNull(),
    isUp: t.boolean(), // null until revealed
    predictedUpBps: t.integer(), // null until RBTS reveal
    rbtsWeight: t.bigint(), // null until RBTS reveal
    rbtsScoreBps: t.integer(), // null until RBTS rewards are scored
    rbtsRewardWeight: t.bigint(), // null until RBTS rewards are scored
    rbtsStakeReturned: t.bigint(), // null until RBTS rewards are scored
    rbtsForfeitedStake: t.bigint(), // null until RBTS rewards are scored
    stake: t.bigint().notNull(),
    epochIndex: t.integer().notNull(), // 0=epoch-1 (100% weight), 1=epoch-2+ (25% weight)
    revealed: t.boolean().notNull().default(false),
    committedAt: t.bigint().notNull(),
    commitTxHash: t.hex(),
    commitBlockNumber: t.bigint(),
    commitLogIndex: t.integer(),
    revealedAt: t.bigint(), // null until revealed
  }),
  (table) => ({
    voterIdx: index().on(table.voter),
    identityKeyIdx: index().on(table.identityKey),
    identityHolderIdx: index().on(table.identityHolder),
    contentIdx: index().on(table.contentId),
    roundIdx: index().on(table.roundId),
    contentRoundIdx: index().on(table.contentId, table.roundId),
    voterContentCommittedAtIdx: index().on(
      table.voter,
      table.contentId,
      table.committedAt,
    ),
    commitHashIdx: index().on(table.commitHash),
    commitKeyIdx: index().on(table.commitKey),
    revealedIdx: index().on(table.revealed),
  }),
);

export const voteRelations = relations(vote, ({ one }) => ({
  roundRef: one(round, {
    fields: [vote.contentId, vote.roundId],
    references: [round.contentId, round.roundId],
  }),
  voterProfile: one(profile, {
    fields: [vote.voter],
    references: [profile.address],
  }),
}));

export const advisoryVote = onchainTable(
  "advisory_vote",
  (t) => ({
    id: t.hex().primaryKey(),
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    voter: t.hex().notNull(),
    commitHash: t.hex().notNull(),
    ciphertextHash: t.hex().notNull(),
    ciphertext: t.hex().notNull(),
    ciphertextSource: t.text().notNull().default("event"),
    targetRound: t.bigint().notNull(),
    drandChainHash: t.hex().notNull(),
    roundReferenceRatingBps: t.integer().notNull(),
    isUp: t.boolean(),
    predictedUpBps: t.integer(),
    scoreBps: t.integer(),
    paidAmount: t.bigint().notNull().default(0n),
    launchCreditClaimed: t.boolean().notNull().default(false),
    revealed: t.boolean().notNull().default(false),
    committedAt: t.bigint().notNull(),
    commitTxHash: t.hex(),
    commitBlockNumber: t.bigint(),
    commitLogIndex: t.integer(),
    revealedAt: t.bigint(),
    creditedAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    voterIdx: index().on(table.voter),
    contentIdx: index().on(table.contentId),
    roundIdx: index().on(table.roundId),
    contentRoundIdx: index().on(table.contentId, table.roundId),
    revealedIdx: index().on(table.revealed),
    launchCreditClaimedIdx: index().on(table.launchCreditClaimed),
  }),
);

// ============================================================
// REWARD CLAIMS
// ============================================================

export const rewardClaim = onchainTable(
  "reward_claim",
  (t) => ({
    id: t.text().primaryKey(), // unique claim/event id
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    epochId: t.bigint(), // set only for epoch-based claims (distinguishes from round-based)
    source: t.text().notNull(), // "round", "launch", or "refund" (no handler writes "epoch" anymore)
    // For round-based RewardClaimed: `voter` receives `lrepReward` (current SBT holder),
    // `stakePayer` receives `stakeReturned` (original commit.voter — typically a delegate).
    // When `stakePayer` is null/equal to `voter`, the two collapse (no delegation split).
    voter: t.hex().notNull(),
    stakePayer: t.hex(),
    stakeReturned: t.bigint().notNull(),
    lrepReward: t.bigint().notNull(),
    claimedAt: t.bigint().notNull(),
  }),
  (table) => ({
    voterIdx: index().on(table.voter),
    stakePayerIdx: index().on(table.stakePayer),
    contentIdx: index().on(table.contentId),
  }),
);

// ============================================================
// QUESTION REWARD POOLS (LREP or USDC)
// ============================================================

export const questionRewardPool = onchainTable(
  "question_reward_pool",
  (t) => ({
    id: t.bigint().primaryKey(),
    contentId: t.bigint().notNull(),
    funder: t.hex().notNull(),
    funderIdentityKey: t.hex().notNull(),
    payerIdentity: t.hex().notNull(),
    payerIdentityKey: t.hex().notNull(),
    submitterIdentity: t.hex().notNull(),
    submitterIdentityKey: t.hex().notNull(),
    asset: t.integer().notNull(),
    nonRefundable: t.boolean().notNull(),
    bountyKind: t.integer().notNull(),
    bountyEligibility: t.integer().notNull(),
    bountyEligibilityDataHash: t.hex().notNull(),
    challengedRoundId: t.bigint().notNull(),
    reasonHash: t.hex().notNull(),
    fundedAmount: t.bigint().notNull(),
    unallocatedAmount: t.bigint().notNull(),
    allocatedAmount: t.bigint().notNull(),
    claimedAmount: t.bigint().notNull(),
    voterClaimedAmount: t.bigint().notNull(),
    frontendClaimedAmount: t.bigint().notNull(),
    refundedAmount: t.bigint().notNull(),
    requiredVoters: t.integer().notNull(),
    requiredSettledRounds: t.integer().notNull(),
    qualifiedRounds: t.integer().notNull(),
    frontendFeeBps: t.integer().notNull(),
    startRoundId: t.bigint().notNull(),
    bountyStartBy: t.bigint().notNull(),
    bountyOpensAt: t.bigint().notNull(),
    bountyClosesAt: t.bigint().notNull(),
    feedbackClosesAt: t.bigint().notNull(),
    bountyWindowSeconds: t.integer().notNull(),
    feedbackWindowSeconds: t.integer().notNull(),
    expiresAt: t.bigint().notNull(),
    refunded: t.boolean().notNull(),
    createdAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    contentIdx: index().on(table.contentId),
    funderIdx: index().on(table.funder),
    funderIdentityKeyIdx: index().on(table.funderIdentityKey),
    payerIdentityIdx: index().on(table.payerIdentity),
    payerIdentityKeyIdx: index().on(table.payerIdentityKey),
    submitterIdentityIdx: index().on(table.submitterIdentity),
    submitterIdentityKeyIdx: index().on(table.submitterIdentityKey),
    refundedIdx: index().on(table.refunded),
    bountyKindIdx: index().on(table.bountyKind),
    challengedRoundIdx: index().on(table.challengedRoundId),
    bountyStartByIdx: index().on(table.bountyStartBy),
    bountyClosesAtIdx: index().on(table.bountyClosesAt),
    feedbackClosesAtIdx: index().on(table.feedbackClosesAt),
    createdAtIdx: index().on(table.createdAt),
  }),
);

export const questionRewardPoolRound = onchainTable(
  "question_reward_pool_round",
  (t) => ({
    id: t.text().primaryKey(), // `${rewardPoolId}-${roundId}`
    rewardPoolId: t.bigint().notNull(),
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    allocation: t.bigint().notNull(),
    frontendFeeAllocation: t.bigint().notNull(),
    eligibleVoters: t.integer().notNull(),
    rawEligibleVoters: t.integer().notNull(),
    effectiveParticipantUnits: t.integer().notNull(),
    totalClaimWeight: t.bigint().notNull(),
    correlationEpochId: t.bigint(),
    correlationWeightRoot: t.hex(),
    claimedAmount: t.bigint().notNull(),
    voterClaimedAmount: t.bigint().notNull(),
    frontendClaimedAmount: t.bigint().notNull(),
    claimedCount: t.integer().notNull(),
    qualifiedAt: t.bigint().notNull(),
  }),
  (table) => ({
    rewardPoolIdx: index().on(table.rewardPoolId),
    contentIdx: index().on(table.contentId),
    roundIdx: index().on(table.contentId, table.roundId),
  }),
);

export const correlationEpochSnapshot = onchainTable(
  "correlation_epoch_snapshot",
  (t) => ({
    id: t.bigint().primaryKey(),
    fromRoundId: t.bigint().notNull(),
    toRoundId: t.bigint().notNull(),
    proposer: t.hex().notNull(),
    frontendOperator: t.hex().notNull(),
    challenger: t.hex(),
    clusterRoot: t.hex().notNull(),
    parameterHash: t.hex().notNull(),
    artifactHash: t.hex().notNull(),
    artifactUri: t.text().notNull(),
    status: t.integer().notNull(),
    proposedAt: t.bigint().notNull(),
    finalizedAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    statusIdx: index().on(table.status),
    frontendOperatorIdx: index().on(table.frontendOperator),
    proposedAtIdx: index().on(table.proposedAt),
    finalizedAtIdx: index().on(table.finalizedAt),
  }),
);

export const roundPayoutSnapshot = onchainTable(
  "round_payout_snapshot",
  (t) => ({
    id: t.hex().primaryKey(),
    domain: t.integer().notNull(),
    rewardPoolId: t.bigint().notNull(),
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    correlationEpochId: t.bigint().notNull(),
    proposer: t.hex().notNull(),
    frontendOperator: t.hex().notNull(),
    challenger: t.hex(),
    rawEligibleVoters: t.integer().notNull(),
    effectiveParticipantUnits: t.integer().notNull(),
    totalClaimWeight: t.bigint().notNull(),
    weightRoot: t.hex().notNull(),
    reasonRoot: t.hex().notNull(),
    artifactHash: t.hex().notNull(),
    artifactUri: t.text().notNull(),
    status: t.integer().notNull(),
    proposedAt: t.bigint().notNull(),
    finalizedAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    domainIdx: index().on(table.domain),
    contentRoundIdx: index().on(table.contentId, table.roundId),
    rewardPoolIdx: index().on(table.rewardPoolId),
    epochIdx: index().on(table.correlationEpochId),
    frontendOperatorIdx: index().on(table.frontendOperator),
    statusIdx: index().on(table.status),
  }),
);

export const payoutArtifactCache = onchainTable(
  "payout_artifact_cache",
  (t) => ({
    artifactHash: t.hex().primaryKey(),
    artifactUri: t.text().notNull(),
    canonicalJson: t.text().notNull(),
    byteLength: t.integer().notNull(),
    firstSeenAt: t.bigint().notNull(),
    lastFetchedAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    lastFetchedAtIdx: index().on(table.lastFetchedAt),
  }),
);

export const questionRewardPoolClaim = onchainTable(
  "question_reward_pool_claim",
  (t) => ({
    id: t.text().primaryKey(), // `${rewardPoolId}-${roundId}-${claimant}-${identityKey}`
    rewardPoolId: t.bigint().notNull(),
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    claimant: t.hex().notNull(),
    identityKey: t.hex().notNull(),
    amount: t.bigint().notNull(),
    grossAmount: t.bigint().notNull(),
    frontend: t.hex().notNull(),
    frontendRecipient: t.hex().notNull(),
    frontendFee: t.bigint().notNull(),
    claimedAt: t.bigint().notNull(),
  }),
  (table) => ({
    rewardPoolIdx: index().on(table.rewardPoolId),
    claimantIdx: index().on(table.claimant),
    identityKeyIdx: index().on(table.identityKey),
    contentIdx: index().on(table.contentId),
  }),
);

export const questionBundleReward = onchainTable(
  "question_bundle_reward",
  (t) => ({
    id: t.bigint().primaryKey(),
    funder: t.hex().notNull(),
    funderIdentityKey: t.hex().notNull(),
    asset: t.integer().notNull(),
    fundedAmount: t.bigint().notNull(),
    claimedAmount: t.bigint().notNull(),
    voterClaimedAmount: t.bigint().notNull(),
    frontendClaimedAmount: t.bigint().notNull(),
    refundedAmount: t.bigint().notNull(),
    unallocatedAmount: t.bigint().notNull(),
    allocatedAmount: t.bigint().notNull(),
    requiredCompleters: t.integer().notNull(),
    requiredSettledRounds: t.integer().notNull(),
    questionCount: t.integer().notNull(),
    completedRoundSetCount: t.integer().notNull(),
    totalRecordedQuestionRounds: t.integer().notNull(),
    claimedCount: t.integer().notNull(),
    frontendFeeBps: t.integer().notNull(),
    bountyEligibility: t.integer().notNull(),
    bountyEligibilityDataHash: t.hex().notNull(),
    bountyStartBy: t.bigint().notNull(),
    bountyOpensAt: t.bigint().notNull(),
    bountyClosesAt: t.bigint().notNull(),
    feedbackClosesAt: t.bigint().notNull(),
    bountyWindowSeconds: t.integer().notNull(),
    feedbackWindowSeconds: t.integer().notNull(),
    expiresAt: t.bigint().notNull(),
    failed: t.boolean().notNull(),
    refunded: t.boolean().notNull(),
    createdAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    funderIdx: index().on(table.funder),
    funderIdentityKeyIdx: index().on(table.funderIdentityKey),
    assetIdx: index().on(table.asset),
    failedIdx: index().on(table.failed),
    refundedIdx: index().on(table.refunded),
    bountyStartByIdx: index().on(table.bountyStartBy),
    bountyClosesAtIdx: index().on(table.bountyClosesAt),
    completedRoundSetIdx: index().on(
      table.completedRoundSetCount,
      table.requiredSettledRounds,
    ),
    createdAtIdx: index().on(table.createdAt),
  }),
);

export const questionBundleQuestion = onchainTable(
  "question_bundle_question",
  (t) => ({
    id: t.text().primaryKey(), // `${bundleId}-${bundleIndex}`
    bundleId: t.bigint().notNull(),
    contentId: t.bigint().notNull(),
    bundleIndex: t.integer().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    bundleIdx: index().on(table.bundleId),
    contentIdx: index().on(table.contentId),
    bundleIndexIdx: index().on(table.bundleId, table.bundleIndex),
  }),
);

export const questionBundleRound = onchainTable(
  "question_bundle_round",
  (t) => ({
    id: t.text().primaryKey(), // `${bundleId}-${roundSetIndex}-${bundleIndex}`
    bundleId: t.bigint().notNull(),
    contentId: t.bigint().notNull(),
    bundleIndex: t.integer().notNull(),
    roundSetIndex: t.integer().notNull(),
    roundId: t.bigint().notNull(),
    settled: t.boolean().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    bundleIdx: index().on(table.bundleId),
    contentIdx: index().on(table.contentId),
    roundSetIdx: index().on(table.bundleId, table.roundSetIndex),
    bundleIndexIdx: index().on(table.bundleId, table.bundleIndex),
  }),
);

export const questionBundleRoundSet = onchainTable(
  "question_bundle_round_set",
  (t) => ({
    id: t.text().primaryKey(), // `${bundleId}-${roundSetIndex}`
    bundleId: t.bigint().notNull(),
    roundSetIndex: t.integer().notNull(),
    allocation: t.bigint().notNull(),
    frontendFeeAllocation: t.bigint().notNull(),
    rawEligibleCompleters: t.integer().notNull().default(0),
    effectiveParticipantUnits: t.integer().notNull().default(0),
    totalClaimWeight: t.bigint().notNull().default(0n),
    correlationEpochId: t.bigint(),
    correlationWeightRoot: t.hex(),
    claimedAmount: t.bigint().notNull(),
    voterClaimedAmount: t.bigint().notNull(),
    frontendClaimedAmount: t.bigint().notNull(),
    claimedCount: t.integer().notNull(),
    qualifiedAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    bundleIdx: index().on(table.bundleId),
    roundSetIdx: index().on(table.bundleId, table.roundSetIndex),
  }),
);

export const questionBundleRecoveredRoundSet = onchainTable(
  "question_bundle_recovered_round_set",
  (t) => ({
    id: t.text().primaryKey(), // `${bundleId}-${roundSetIndex}`
    bundleId: t.bigint().notNull(),
    roundSetIndex: t.integer().notNull(),
    allocationReturned: t.bigint(),
    newWeightRoot: t.hex(),
    recoveredAt: t.bigint(),
    reopenedAt: t.bigint(),
    requalifiedAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    bundleIdx: index().on(table.bundleId),
    roundSetIdx: index().on(table.bundleId, table.roundSetIndex),
  }),
);

export const questionBundleClaim = onchainTable(
  "question_bundle_claim",
  (t) => ({
    id: t.text().primaryKey(), // `${bundleId}-${roundSetIndex}-${claimant}-${identityKey}`
    bundleId: t.bigint().notNull(),
    roundSetIndex: t.integer().notNull(),
    claimant: t.hex().notNull(),
    identityKey: t.hex().notNull(),
    amount: t.bigint().notNull(),
    grossAmount: t.bigint().notNull(),
    frontend: t.hex().notNull(),
    frontendRecipient: t.hex().notNull(),
    frontendFee: t.bigint().notNull(),
    claimedAt: t.bigint().notNull(),
  }),
  (table) => ({
    bundleIdx: index().on(table.bundleId),
    roundSetIdx: index().on(table.bundleId, table.roundSetIndex),
    claimantIdx: index().on(table.claimant),
    identityKeyIdx: index().on(table.identityKey),
  }),
);

export const questionBundleTerminalSkip = onchainTable(
  "question_bundle_terminal_skip",
  (t) => ({
    id: t.text().primaryKey(), // `${txHash}-${logIndex}`
    bundleId: t.bigint().notNull(),
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    reasonCode: t.integer().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    transactionHash: t.hex(),
    skippedAt: t.bigint().notNull(),
  }),
  (table) => ({
    bundleIdx: index().on(table.bundleId),
    contentIdx: index().on(table.contentId),
    roundIdx: index().on(table.contentId, table.roundId),
    reasonIdx: index().on(table.reasonCode),
    skippedAtIdx: index().on(table.skippedAt),
  }),
);

// ============================================================
// CONFIDENTIALITY
// ============================================================

export const confidentialityConfig = onchainTable(
  "confidentiality_config",
  (t) => ({
    contentId: t.bigint().primaryKey(),
    gated: t.boolean().notNull(),
    bondAsset: t.integer().notNull(),
    bondAmount: t.bigint().notNull(),
    flags: t.integer().notNull(),
    configuredAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    gatedIdx: index().on(table.gated),
    bondAssetIdx: index().on(table.bondAsset),
  }),
);

export const confidentialityBond = onchainTable(
  "confidentiality_bond",
  (t) => ({
    id: t.text().primaryKey(), // `${contentId}-${identityKey}`
    contentId: t.bigint().notNull(),
    identityKey: t.hex().notNull(),
    poster: t.hex().notNull(),
    asset: t.integer().notNull(),
    amount: t.bigint().notNull(),
    status: t.text().notNull(), // "active", "released", or "slashed"
    postedAt: t.bigint().notNull(),
    releasedAt: t.bigint(),
    slashedAt: t.bigint(),
    reporterRecipient: t.hex(),
    reporterAmount: t.bigint(),
    confiscatedAmount: t.bigint(),
    evidenceHash: t.hex(),
    reason: t.text(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    contentIdx: index().on(table.contentId),
    identityKeyIdx: index().on(table.identityKey),
    posterIdx: index().on(table.poster),
    statusIdx: index().on(table.status),
  }),
);

export const raterIdentityBan = onchainTable(
  "rater_identity_ban",
  (t) => ({
    id: t.text().primaryKey(), // `${provider}-${nullifierHash}`
    provider: t.integer().notNull(),
    nullifierHash: t.hex().notNull(),
    active: t.boolean().notNull(),
    permanent: t.boolean().notNull(),
    expiresAt: t.bigint().notNull(),
    evidenceHash: t.hex().notNull(),
    reason: t.text().notNull(),
    bannedAt: t.bigint().notNull(),
    unbannedAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    providerNullifierIdx: index().on(table.provider, table.nullifierHash),
    activeIdx: index().on(table.active),
    expiresAtIdx: index().on(table.expiresAt),
  }),
);

export const raterRegistryConfig = onchainTable(
  "rater_registry_config",
  (t) => ({
    id: t.text().primaryKey(),
    confidentialityEscrow: t.hex(),
    updatedAt: t.bigint().notNull(),
  }),
);

// ============================================================
// FEEDBACK BONUS POOLS
// ============================================================

export const feedbackBonusPool = onchainTable(
  "feedback_bonus_pool",
  (t) => ({
    id: t.bigint().primaryKey(),
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    funder: t.hex().notNull(),
    awarder: t.hex().notNull(),
    asset: t.integer().notNull(),
    fundedAmount: t.bigint().notNull(),
    remainingAmount: t.bigint().notNull(),
    awardedAmount: t.bigint().notNull(),
    voterAwardedAmount: t.bigint().notNull(),
    frontendAwardedAmount: t.bigint().notNull(),
    forfeitedAmount: t.bigint().notNull(),
    awardCount: t.integer().notNull(),
    feedbackClosesAt: t.bigint().notNull(),
    awardDeadline: t.bigint().notNull(),
    frontendFeeBps: t.integer().notNull(),
    forfeited: t.boolean().notNull(),
    createdAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    contentIdx: index().on(table.contentId),
    roundIdx: index().on(table.contentId, table.roundId),
    funderIdx: index().on(table.funder),
    awarderIdx: index().on(table.awarder),
    forfeitedIdx: index().on(table.forfeited),
    feedbackClosesAtIdx: index().on(table.feedbackClosesAt),
    awardDeadlineIdx: index().on(table.awardDeadline),
  }),
);

export const feedbackBonusAward = onchainTable(
  "feedback_bonus_award",
  (t) => ({
    id: t.text().primaryKey(), // `${poolId}-${feedbackHash}`
    poolId: t.bigint().notNull(),
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    recipient: t.hex().notNull(),
    identityKey: t.hex().notNull(),
    feedbackHash: t.hex().notNull(),
    asset: t.integer().notNull(),
    grossAmount: t.bigint().notNull(),
    recipientAmount: t.bigint().notNull(),
    frontend: t.hex().notNull(),
    frontendRecipient: t.hex().notNull(),
    frontendFee: t.bigint().notNull(),
    awardedAt: t.bigint().notNull(),
  }),
  (table) => ({
    poolIdx: index().on(table.poolId),
    contentIdx: index().on(table.contentId),
    roundIdx: index().on(table.contentId, table.roundId),
    recipientIdx: index().on(table.recipient),
    identityKeyIdx: index().on(table.identityKey),
    feedbackHashIdx: index().on(table.feedbackHash),
  }),
);

// ============================================================
// CONTENT FEEDBACK (canonical on-chain anchors)
// ============================================================

export const contentFeedback = onchainTable(
  "content_feedback",
  (t) => ({
    id: t.text().primaryKey(), // `${contentId}-${roundId}-${commitKey}`
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    commitKey: t.hex().notNull(),
    author: t.hex().notNull(),
    feedbackHash: t.hex().notNull(),
    committedAt: t.bigint().notNull(),
    commitTxHash: t.hex(),
    commitBlockNumber: t.bigint(),
    commitLogIndex: t.integer(),
    revealed: t.boolean().notNull(),
    feedbackType: t.text(),
    body: t.text(),
    sourceUrl: t.text(),
    clientNonce: t.hex(),
    revealedAt: t.bigint(),
    revealTxHash: t.hex(),
    revealBlockNumber: t.bigint(),
    revealLogIndex: t.integer(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    contentIdx: index().on(table.contentId),
    roundIdx: index().on(table.contentId, table.roundId),
    authorIdx: index().on(table.author),
    commitKeyIdx: index().on(table.commitKey),
    feedbackHashIdx: index().on(table.feedbackHash),
    revealedIdx: index().on(table.revealed),
  }),
);

// ============================================================
// CATEGORY
// ============================================================

export const category = onchainTable(
  "category",
  (t) => ({
    id: t.bigint().primaryKey(),
    name: t.text().notNull(),
    slug: t.text().notNull(),
    createdAt: t.bigint().notNull(),
    totalVotes: t.integer().notNull(),
    totalContent: t.integer().notNull(),
  }),
  (table) => ({
    slugIdx: index().on(table.slug),
  }),
);

export const categoryRelations = relations(category, ({ many }) => ({
  contents: many(content),
}));

// ============================================================
// RATER REGISTRY
// ============================================================

export const raterProfile = onchainTable(
  "rater_profile",
  (t) => ({
    address: t.hex().primaryKey(),
    raterType: t.integer().notNull(),
    metadataHash: t.hex().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    raterTypeIdx: index().on(table.raterType),
    updatedAtIdx: index().on(table.updatedAt),
  }),
);

export const raterHumanCredential = onchainTable(
  "rater_human_credential",
  (t) => ({
    rater: t.hex().primaryKey(),
    verified: t.boolean().notNull(),
    revoked: t.boolean().notNull(),
    provider: t.integer().notNull(),
    nullifierHash: t.hex().notNull(),
    scope: t.hex().notNull(),
    verifiedAt: t.bigint().notNull(),
    expiresAt: t.bigint().notNull(),
    evidenceHash: t.hex().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    nullifierIdx: index().on(table.nullifierHash),
    providerIdx: index().on(table.provider),
    revokedIdx: index().on(table.revoked),
    expiresAtIdx: index().on(table.expiresAt),
  }),
);

export const raterWorldCredential = onchainTable(
  "rater_world_credential",
  (t) => ({
    id: t.text().primaryKey(), // `${rater}-${kind}`
    rater: t.hex().notNull(),
    kind: t.integer().notNull(), // 1=Selfie Check, 2=Passport, 3=Proof of Human
    verified: t.boolean().notNull(),
    revoked: t.boolean().notNull(),
    nullifierHash: t.hex().notNull(),
    scope: t.hex().notNull(),
    verifiedAt: t.bigint().notNull(),
    expiresAt: t.bigint().notNull(),
    evidenceHash: t.hex().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    raterIdx: index().on(table.rater),
    kindIdx: index().on(table.kind),
    raterKindIdx: index().on(table.rater, table.kind),
    nullifierIdx: index().on(table.nullifierHash),
    revokedIdx: index().on(table.revoked),
    expiresAtIdx: index().on(table.expiresAt),
  }),
);

export const raterHumanPresence = onchainTable(
  "rater_human_presence",
  (t) => ({
    id: t.text().primaryKey(), // `${rater}-${kind}`
    rater: t.hex().notNull(),
    kind: t.integer().notNull(), // credential kind rechecked by World ID user presence
    verified: t.boolean().notNull(),
    nullifierHash: t.hex().notNull(),
    lastRecheckedAt: t.bigint().notNull(),
    freshUntil: t.bigint().notNull(),
    evidenceHash: t.hex().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    raterIdx: index().on(table.rater),
    kindIdx: index().on(table.kind),
    raterKindIdx: index().on(table.rater, table.kind),
    nullifierIdx: index().on(table.nullifierHash),
    freshUntilIdx: index().on(table.freshUntil),
  }),
);

export const raterFollow = onchainTable(
  "rater_follow",
  (t) => ({
    id: t.text().primaryKey(), // `${follower}-${target}`
    follower: t.hex().notNull(),
    target: t.hex().notNull(),
    active: t.boolean().notNull(),
    createdAt: t.bigint().notNull(),
    unfollowedAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    followerIdx: index().on(table.follower),
    targetIdx: index().on(table.target),
    activeIdx: index().on(table.active),
    followerActiveIdx: index().on(table.follower, table.active),
    targetActiveIdx: index().on(table.target, table.active),
  }),
);

export const launchRewardPolicyState = onchainTable(
  "launch_reward_policy_state",
  (t) => ({
    id: t.text().primaryKey(),
    minQualifyingScoreBps: t.integer().notNull(),
    minVoters: t.integer().notNull(),
    minVerifiedHumans: t.integer().notNull(),
    minDistinctVerifiedAnchors: t.integer().notNull(),
    minDistinctAnchorRounds: t.integer().notNull(),
    eligibilityRatingCount: t.integer().notNull(),
    rewardingRatingCount: t.integer().notNull(),
    unverifiedEarnedRaterCapBps: t.integer().notNull(),
    minAnchorCredentialAgeSeconds: t.integer().notNull(),
    requireNoPendingCleanup: t.boolean().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    updatedAtIdx: index().on(table.updatedAt),
  }),
);

export const launchRaterRewardProgress = onchainTable(
  "launch_rater_reward_progress",
  (t) => ({
    rater: t.hex().primaryKey(),
    qualifyingRatingCount: t.integer().notNull(),
    qualifyingCreditBps: t.bigint().notNull(),
    rewardedRatingCount: t.integer().notNull(),
    distinctVerifiedAnchorCount: t.integer().notNull(),
    distinctAnchorRoundCount: t.integer().notNull(),
    payoutEligible: t.boolean().notNull(),
    launchCap: t.bigint().notNull(),
    fullLaunchCap: t.bigint().notNull(),
    capBps: t.integer().notNull(),
    fullCapUnlocked: t.boolean().notNull(),
    capUnlockNullifierHash: t.hex(),
    launchPaid: t.bigint().notNull(),
    cohortIndex: t.bigint(),
    lastQualifiedContentId: t.bigint(),
    lastQualifiedRoundId: t.bigint(),
    lastCommitKey: t.hex(),
    lastScoreBps: t.integer(),
    eligibleAt: t.bigint(),
    latestCreditedAt: t.bigint(),
    latestPaidAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    payoutEligibleIdx: index().on(table.payoutEligible),
    latestCreditedAtIdx: index().on(table.latestCreditedAt),
    latestPaidAtIdx: index().on(table.latestPaidAt),
  }),
);

export const launchEarnedRaterCredit = onchainTable(
  "launch_earned_rater_credit",
  (t) => ({
    id: t.text().primaryKey(), // `${contentId}-${roundId}-${commitKey}`
    rater: t.hex().notNull(),
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    commitKey: t.hex().notNull(),
    scoreBps: t.integer().notNull(),
    pending: t.boolean().notNull(),
    finalized: t.boolean().notNull(),
    cancelled: t.boolean().notNull(),
    effectiveCreditBps: t.bigint(),
    qualifyingCreditBps: t.bigint(),
    recordedAt: t.bigint().notNull(),
    finalizedAt: t.bigint(),
    cancelledAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    raterIdx: index().on(table.rater),
    roundIdx: index().on(table.contentId, table.roundId),
    pendingIdx: index().on(table.pending),
    finalizedIdx: index().on(table.finalized),
  }),
);

// ============================================================
// PROFILE
// ============================================================

export const profile = onchainTable(
  "profile",
  (t) => ({
    address: t.hex().primaryKey(),
    name: t.text().notNull(),
    selfReport: t.text().notNull(),
    selfReportedRaterType: t.integer().notNull(),
    createdAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
    totalVotes: t.integer().notNull(),
    totalContent: t.integer().notNull(),
    totalRewardsClaimed: t.bigint().notNull(),
  }),
  (table) => ({
    selfReportedRaterTypeIdx: index().on(table.selfReportedRaterType),
  }),
);

export const profileSelfReportHistory = onchainTable(
  "profile_self_report_history",
  (t) => ({
    id: t.text().primaryKey(), // `${address}-${blockNumber}-${logIndex}`
    address: t.hex().notNull(),
    name: t.text().notNull(),
    selfReport: t.text().notNull(),
    selfReportedRaterType: t.integer().notNull(),
    createdAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    transactionHash: t.hex(),
  }),
  (table) => ({
    addressUpdatedAtIdx: index().on(table.address, table.updatedAt),
    addressBlockIdx: index().on(
      table.address,
      table.blockNumber,
      table.logIndex,
    ),
    updatedAtIdx: index().on(table.updatedAt),
  }),
);

// ============================================================
// VOTER ACCURACY STATS (global per voter)
// ============================================================

export const voterStats = onchainTable("voter_stats", (t) => ({
  voter: t.hex().primaryKey(),
  totalSettledVotes: t.integer().notNull(),
  totalWins: t.integer().notNull(),
  totalLosses: t.integer().notNull(),
  totalStakeWon: t.bigint().notNull(),
  totalStakeLost: t.bigint().notNull(),
  currentStreak: t.integer().notNull(), // positive = win streak, negative = loss streak
  bestWinStreak: t.integer().notNull(),
}));

// ============================================================
// VOTER CATEGORY STATS (per voter per category)
// ============================================================

export const voterCategoryStats = onchainTable(
  "voter_category_stats",
  (t) => ({
    id: t.text().primaryKey(), // `${voter}-${categoryId}`
    voter: t.hex().notNull(),
    categoryId: t.bigint().notNull(),
    totalSettledVotes: t.integer().notNull(),
    totalWins: t.integer().notNull(),
    totalLosses: t.integer().notNull(),
    totalStakeWon: t.bigint().notNull(),
    totalStakeLost: t.bigint().notNull(),
  }),
  (table) => ({
    voterIdx: index().on(table.voter),
    categoryIdx: index().on(table.categoryId),
  }),
);

// ============================================================
// FRONTEND
// ============================================================

export const frontend = onchainTable("frontend", (t) => ({
  address: t.hex().primaryKey(),
  operator: t.hex().notNull(),
  stakedAmount: t.bigint().notNull(),
  eligible: t.boolean().notNull(),
  slashed: t.boolean().notNull(),
  exitAvailableAt: t.bigint(),
  totalFeesCredited: t.bigint().notNull(),
  totalFeesClaimed: t.bigint().notNull(),
  // Two-step fee withdrawals: the requested amount stays slashable in the registry
  // until the release timestamp passes (FrontendRegistry.FEE_WITHDRAWAL_DELAY).
  pendingFeeWithdrawal: t.bigint().notNull().default(0n),
  pendingFeeWithdrawalReleaseAt: t.bigint(),
  // LREP routed to successful oracle challengers out of this frontend's slashes.
  totalChallengerBountiesPaid: t.bigint().notNull().default(0n),
  // Fees zeroed by FrontendRegistry.slashFrontend (FeesConfiscated). Claimable/pending
  // frontend fees are totalFeesCredited - totalFeesClaimed - totalFeesConfiscated
  // - pendingFeeWithdrawal; the pending withdrawal bucket is exposed separately.
  totalFeesConfiscated: t.bigint().notNull().default(0n),
  registeredAt: t.bigint().notNull(),
}));

// ============================================================
// TOKEN HOLDERS (LREP)
// ============================================================

export const tokenHolder = onchainTable("token_holder", (t) => ({
  address: t.hex().primaryKey(),
  firstSeenAt: t.bigint().notNull(),
}));

// ============================================================
// TOKEN TRANSFERS (LREP balance history)
// ============================================================

export const tokenTransfer = onchainTable(
  "token_transfer",
  (t) => ({
    id: t.text().primaryKey(), // `${txHash}-${logIndex}`
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    amount: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    fromIdx: index().on(table.from),
    toIdx: index().on(table.to),
    timestampIdx: index().on(table.timestamp),
  }),
);

// ============================================================
// GLOBAL STATS (singleton, id="global")
// ============================================================

export const globalStats = onchainTable("global_stats", (t) => ({
  id: t.text().primaryKey(),
  totalContent: t.integer().notNull(),
  totalVotes: t.integer().notNull(),
  totalRoundsSettled: t.integer().notNull(),
  totalRewardsClaimed: t.bigint().notNull(),
  // Frontend fees are a distinct flow from voter reward claims and must not
  // inflate totalRewardsClaimed. Tracked separately here.
  totalFrontendFeesClaimed: t.bigint().notNull().default(0n),
  totalProfiles: t.integer().notNull(),
  // Distinct voter identities with at least one settled vote; incremented in
  // the RoundSettled handler when a voterStats row is created for an identity
  // seen for the first time.
  totalVoterIds: t.integer().notNull(),
}));

// ============================================================
// RATING HISTORY
// ============================================================

export const ratingChange = onchainTable(
  "rating_change",
  (t) => ({
    id: t.text().primaryKey(), // `${contentId}-${roundId}-${blockNumber}`
    contentId: t.bigint().notNull(),
    roundId: t.bigint().notNull(),
    oldRating: t.integer().notNull(),
    newRating: t.integer().notNull(),
    referenceRatingBps: t.integer().notNull(),
    oldRatingBps: t.integer().notNull(),
    newRatingBps: t.integer().notNull(),
    conservativeRatingBps: t.integer().notNull(),
    confidenceMass: t.bigint().notNull(),
    effectiveEvidence: t.bigint().notNull(),
    upEvidence: t.bigint().notNull(),
    downEvidence: t.bigint().notNull(),
    settledRounds: t.integer().notNull(),
    lowSince: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    contentIdx: index().on(table.contentId),
  }),
);

// ============================================================
// DAILY VOTE ACTIVITY (per voter per day)
// ============================================================

export const dailyVoteActivity = onchainTable(
  "daily_vote_activity",
  (t) => ({
    id: t.text().primaryKey(), // `${voter}-${YYYYMMDD}`
    voter: t.hex().notNull(),
    date: t.text().notNull(), // YYYYMMDD
    voteCount: t.integer().notNull(),
    firstVoteAt: t.bigint().notNull(),
  }),
  (table) => ({
    voterIdx: index().on(table.voter),
    dateIdx: index().on(table.date),
  }),
);

// ============================================================
// VOTER STREAK (daily voting streak tracking)
// ============================================================

export const voterStreak = onchainTable("voter_streak", (t) => ({
  voter: t.hex().primaryKey(),
  currentDailyStreak: t.integer().notNull(),
  bestDailyStreak: t.integer().notNull(),
  lastActiveDate: t.text().notNull(), // YYYYMMDD
  totalActiveDays: t.integer().notNull(),
  lastMilestoneDay: t.integer().notNull(), // last milestone that triggered a bonus
}));
