import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const signedActionChallenges = pgTable(
  "signed_action_challenges",
  {
    id: text("id").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    action: text("action").notNull(),
    payloadHash: text("payload_hash").notNull(),
    nonce: text("nonce").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    expiresAtIdx: index("signed_action_challenges_expires_at_idx").on(table.expiresAt),
    walletActionIdx: index("signed_action_challenges_wallet_action_idx").on(table.walletAddress, table.action),
  }),
);

export type SignedActionChallenge = typeof signedActionChallenges.$inferSelect;
export type NewSignedActionChallenge = typeof signedActionChallenges.$inferInsert;

export const signedReadSessions = pgTable(
  "signed_read_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    scope: text("scope").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  table => ({
    walletScopeExpiresIdx: index("signed_read_sessions_wallet_scope_expires_idx").on(
      table.walletAddress,
      table.scope,
      table.expiresAt,
    ),
  }),
);

export const signedWriteSessions = pgTable(
  "signed_write_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    scope: text("scope").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  table => ({
    walletScopeExpiresIdx: index("signed_write_sessions_wallet_scope_expires_idx").on(
      table.walletAddress,
      table.scope,
      table.expiresAt,
    ),
  }),
);

export const watchedContent = pgTable(
  "watched_content",
  {
    id: serial("id").primaryKey(),
    deploymentKey: text("deployment_key"),
    chainId: integer("chain_id"),
    contentRegistryAddress: text("content_registry_address"),
    walletAddress: text("wallet_address").notNull(),
    contentId: text("content_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    legacyWalletContentUnique: uniqueIndex("watched_content_legacy_wallet_content_unique")
      .on(table.walletAddress, table.contentId)
      .where(sql`${table.deploymentKey} IS NULL`),
    deploymentWalletContentUnique: uniqueIndex("watched_content_deployment_wallet_content_unique")
      .on(table.deploymentKey, table.walletAddress, table.contentId)
      .where(sql`${table.deploymentKey} IS NOT NULL`),
    walletCreatedAtIdx: index("watched_content_wallet_created_at_idx").on(table.walletAddress, table.createdAt),
    deploymentWalletCreatedAtIdx: index("watched_content_deployment_wallet_created_at_idx").on(
      table.deploymentKey,
      table.walletAddress,
      table.createdAt,
    ),
  }),
);

export const contentFeedback = pgTable(
  "content_feedback",
  {
    id: serial("id").primaryKey(),
    deploymentKey: text("deployment_key"),
    contentRegistryAddress: text("content_registry_address"),
    feedbackRegistryAddress: text("feedback_registry_address"),
    contentId: text("content_id").notNull(),
    roundId: text("round_id"),
    chainId: integer("chain_id"),
    authorAddress: text("author_address").notNull(),
    feedbackType: text("feedback_type").notNull(),
    body: text("body").notNull(),
    sourceUrl: text("source_url"),
    feedbackHash: text("feedback_hash"),
    commitKey: text("commit_key"),
    clientNonce: text("client_nonce"),
    payloadSignature: text("payload_signature"),
    moderationStatus: text("moderation_status").notNull().default("approved"),
    publicationTxHash: text("publication_tx_hash"),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    contentCreatedAtIdx: index("content_feedback_content_created_at_idx").on(table.contentId, table.createdAt),
    contentRoundIdx: index("content_feedback_content_round_idx").on(table.contentId, table.roundId),
    deploymentContentCreatedAtIdx: index("content_feedback_deployment_content_created_at_idx").on(
      table.deploymentKey,
      table.contentId,
      table.createdAt,
    ),
    deploymentContentRoundIdx: index("content_feedback_deployment_content_round_idx").on(
      table.deploymentKey,
      table.contentId,
      table.roundId,
    ),
    authorCreatedAtIdx: index("content_feedback_author_created_at_idx").on(table.authorAddress, table.createdAt),
    commitKeyIdx: index("content_feedback_commit_key_idx").on(table.commitKey),
    deploymentFeedbackHashUnique: uniqueIndex("content_feedback_deployment_feedback_hash_unique")
      .on(table.deploymentKey, table.feedbackHash)
      .where(sql`${table.deploymentKey} IS NOT NULL AND ${table.feedbackHash} IS NOT NULL`),
    deploymentActiveAuthorRoundUnique: uniqueIndex("content_feedback_deployment_active_author_round_unique")
      .on(table.deploymentKey, table.contentId, table.roundId, table.authorAddress)
      .where(sql`${table.deploymentKey} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  }),
);

export type ContentFeedback = typeof contentFeedback.$inferSelect;
export type NewContentFeedback = typeof contentFeedback.$inferInsert;

export const notificationPreferences = pgTable("notification_preferences", {
  walletAddress: text("wallet_address").primaryKey(),
  roundResolved: boolean("round_resolved").notNull(),
  settlingSoonHour: boolean("settling_soon_hour").notNull(),
  settlingSoonDay: boolean("settling_soon_day").notNull(),
  followedSubmission: boolean("followed_submission").notNull(),
  followedResolution: boolean("followed_resolution").notNull(),
  contextNowPublic: boolean("context_now_public").notNull().default(true),
  breachReported: boolean("breach_reported").notNull().default(true),
  cohortBreachAnnouncement: boolean("cohort_breach_announcement").notNull().default(true),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
});

export type NotificationPreferences = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferences = typeof notificationPreferences.$inferInsert;

export const notificationEmailSubscriptions = pgTable(
  "notification_email_subscriptions",
  {
    walletAddress: text("wallet_address").primaryKey(),
    email: text("email").notNull(),
    verifiedAt: timestamp("verified_at", { mode: "date", withTimezone: true }),
    verificationToken: text("verification_token"),
    verificationExpiresAt: timestamp("verification_expires_at", { mode: "date", withTimezone: true }),
    roundResolved: boolean("round_resolved").notNull(),
    settlingSoonHour: boolean("settling_soon_hour").notNull(),
    settlingSoonDay: boolean("settling_soon_day").notNull(),
    followedSubmission: boolean("followed_submission").notNull(),
    followedResolution: boolean("followed_resolution").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    emailUnique: uniqueIndex("notification_email_subscriptions_email_unique").on(table.email),
    verificationTokenUnique: uniqueIndex("notification_email_subscriptions_token_unique").on(table.verificationToken),
  }),
);

export type NotificationEmailSubscription = typeof notificationEmailSubscriptions.$inferSelect;
export type NewNotificationEmailSubscription = typeof notificationEmailSubscriptions.$inferInsert;

export const notificationEmailDeliveries = pgTable(
  "notification_email_deliveries",
  {
    id: serial("id").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    email: text("email").notNull(),
    deploymentKey: text("deployment_key"),
    chainId: integer("chain_id"),
    contentRegistryAddress: text("content_registry_address"),
    eventKey: text("event_key").notNull(),
    eventType: text("event_type").notNull(),
    contentId: text("content_id"),
    status: text("status").notNull().default("sent"),
    deliveredAt: timestamp("delivered_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    eventKeyUnique: uniqueIndex("notification_email_deliveries_event_key_unique").on(table.eventKey),
    deploymentContentIdx: index("notification_email_deliveries_deployment_content_idx").on(
      table.deploymentKey,
      table.contentId,
    ),
  }),
);

export const notificationEmailDeliveryLeases = pgTable("notification_email_delivery_leases", {
  eventKey: text("event_key").primaryKey(),
  leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }).notNull(),
});

export type NotificationEmailDelivery = typeof notificationEmailDeliveries.$inferSelect;
export type NewNotificationEmailDelivery = typeof notificationEmailDeliveries.$inferInsert;

export const apiRateLimits = pgTable(
  "api_rate_limits",
  {
    key: text("key").primaryKey(),
    requestCount: integer("request_count").notNull(),
    windowStartedAt: bigint("window_started_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  table => ({
    expiresAtIdx: index("api_rate_limits_expires_at_idx").on(table.expiresAt),
  }),
);

export const apiRateLimitMaintenance = pgTable("api_rate_limit_maintenance", {
  name: text("name").primaryKey(),
  lastCleanupStartedAt: bigint("last_cleanup_started_at", { mode: "number" }).notNull(),
  leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }).notNull(),
});

export type ApiRateLimit = typeof apiRateLimits.$inferSelect;

export const freeTransactionQuotas = pgTable(
  "free_transaction_quotas",
  {
    identityKey: text("identity_key").primaryKey(),
    raterIdentityKey: text("rater_identity_key").notNull(),
    chainId: integer("chain_id").notNull(),
    environment: text("environment").notNull(),
    lastWalletAddress: text("last_wallet_address").notNull(),
    freeTxLimit: integer("free_tx_limit").notNull(),
    freeTxUsed: integer("free_tx_used").notNull(),
    exhaustedAt: timestamp("exhausted_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    identityChainEnvUnique: uniqueIndex("free_transaction_quotas_identity_chain_env_unique").on(
      table.raterIdentityKey,
      table.chainId,
      table.environment,
    ),
    chainUpdatedAtIdx: index("free_transaction_quotas_chain_updated_at_idx").on(table.chainId, table.updatedAt),
  }),
);

export type FreeTransactionQuota = typeof freeTransactionQuotas.$inferSelect;
export type NewFreeTransactionQuota = typeof freeTransactionQuotas.$inferInsert;

export const freeTransactionReservations = pgTable(
  "free_transaction_reservations",
  {
    operationKey: text("operation_key").primaryKey(),
    identityKey: text("identity_key").notNull(),
    raterIdentityKey: text("rater_identity_key").notNull(),
    chainId: integer("chain_id").notNull(),
    environment: text("environment").notNull(),
    walletAddress: text("wallet_address").notNull(),
    reservationSessionToken: text("reservation_session_token"),
    status: text("status").notNull(),
    txHashes: text("tx_hashes"),
    reservedAt: timestamp("reserved_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { mode: "date", withTimezone: true }),
    releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    identityStatusExpiresIdx: index("free_transaction_reservations_identity_status_expires_idx").on(
      table.identityKey,
      table.status,
      table.expiresAt,
    ),
    walletStatusUpdatedIdx: index("free_transaction_reservations_wallet_status_updated_idx").on(
      table.walletAddress,
      table.status,
      table.updatedAt,
    ),
  }),
);

export type FreeTransactionReservation = typeof freeTransactionReservations.$inferSelect;
export type NewFreeTransactionReservation = typeof freeTransactionReservations.$inferInsert;

export const x402QuestionSubmissions = pgTable(
  "x402_question_submissions",
  {
    operationKey: text("operation_key").primaryKey(),
    clientRequestId: text("client_request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    chainId: integer("chain_id").notNull(),
    payerAddress: text("payer_address"),
    paymentAsset: text("payment_asset").notNull(),
    paymentAmount: text("payment_amount").notNull(),
    bountyAmount: text("bounty_amount").notNull(),
    status: text("status").notNull(),
    bundleId: text("bundle_id"),
    contentId: text("content_id"),
    contentIds: text("content_ids"),
    questionCount: integer("question_count").notNull().default(1),
    rewardPoolId: text("reward_pool_id"),
    transactionHashes: text("transaction_hashes"),
    paymentReceipt: text("payment_receipt"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    clientRequestUnique: uniqueIndex("x402_question_submissions_client_request_unique").on(
      table.chainId,
      table.clientRequestId,
    ),
    statusUpdatedIdx: index("x402_question_submissions_status_updated_idx").on(table.status, table.updatedAt),
  }),
);

export type X402QuestionSubmission = typeof x402QuestionSubmissions.$inferSelect;
export type NewX402QuestionSubmission = typeof x402QuestionSubmissions.$inferInsert;

export const questionImageAttachments = pgTable(
  "question_image_attachments",
  {
    id: text("id").primaryKey(),
    uploaderKind: text("uploader_kind").notNull(),
    ownerWalletAddress: text("owner_wallet_address"),
    agentId: text("agent_id"),
    clientRequestId: text("client_request_id"),
    operationKey: text("operation_key"),
    deploymentKey: text("deployment_key"),
    chainId: integer("chain_id"),
    contentRegistryAddress: text("content_registry_address"),
    contentId: text("content_id"),
    requiresGatedAccess: boolean("requires_gated_access").notNull().default(false),
    originalBlobPathname: text("original_blob_pathname"),
    originalBlobUrl: text("original_blob_url"),
    normalizedBlobPathname: text("normalized_blob_pathname"),
    normalizedBlobUrl: text("normalized_blob_url"),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256"),
    status: text("status").notNull(),
    moderationStatus: text("moderation_status").notNull().default("pending"),
    moderationProvider: text("moderation_provider"),
    moderationResult: text("moderation_result"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { mode: "date", withTimezone: true }),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    ownerStatusCreatedIdx: index("question_image_attachments_owner_status_created_idx").on(
      table.ownerWalletAddress,
      table.status,
      table.createdAt,
    ),
    agentStatusCreatedIdx: index("question_image_attachments_agent_status_created_idx").on(
      table.agentId,
      table.status,
      table.createdAt,
    ),
    operationIdx: index("question_image_attachments_operation_idx").on(table.operationKey),
    contentIdx: index("question_image_attachments_content_idx").on(table.contentId),
    deploymentContentIdx: index("question_image_attachments_deployment_content_idx").on(
      table.deploymentKey,
      table.contentId,
    ),
  }),
);

export type QuestionImageAttachment = typeof questionImageAttachments.$inferSelect;
export type NewQuestionImageAttachment = typeof questionImageAttachments.$inferInsert;

export const questionDetails = pgTable(
  "question_details",
  {
    id: text("id").primaryKey(),
    uploaderKind: text("uploader_kind").notNull(),
    ownerWalletAddress: text("owner_wallet_address"),
    agentId: text("agent_id"),
    clientRequestId: text("client_request_id"),
    deploymentKey: text("deployment_key"),
    chainId: integer("chain_id"),
    contentRegistryAddress: text("content_registry_address"),
    contentId: text("content_id"),
    requiresGatedAccess: boolean("requires_gated_access").notNull().default(false),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sha256: text("sha256").notNull(),
    normalizedText: text("normalized_text"),
    status: text("status").notNull(),
    moderationStatus: text("moderation_status").notNull().default("pending"),
    moderationProvider: text("moderation_provider"),
    moderationResult: text("moderation_result"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    ownerStatusCreatedIdx: index("question_details_owner_status_created_idx").on(
      table.ownerWalletAddress,
      table.status,
      table.createdAt,
    ),
    agentStatusCreatedIdx: index("question_details_agent_status_created_idx").on(
      table.agentId,
      table.status,
      table.createdAt,
    ),
    clientRequestIdx: index("question_details_client_request_idx").on(table.clientRequestId),
    contentIdx: index("question_details_content_idx").on(table.contentId),
    deploymentContentIdx: index("question_details_deployment_content_idx").on(table.deploymentKey, table.contentId),
  }),
);

export type QuestionDetails = typeof questionDetails.$inferSelect;
export type NewQuestionDetails = typeof questionDetails.$inferInsert;

export const questionConfidentiality = pgTable(
  "question_confidentiality",
  {
    deploymentKey: text("deployment_key"),
    chainId: integer("chain_id"),
    contentRegistryAddress: text("content_registry_address"),
    frontendAddress: text("frontend_address").notNull(),
    contentId: text("content_id").notNull(),
    gated: boolean("gated").notNull().default(false),
    bondAsset: text("bond_asset"),
    bondAmount: text("bond_amount").notNull().default("0"),
    disclosurePolicy: text("disclosure_policy").notNull().default("private_forever"),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
    questionMetadataHash: text("question_metadata_hash"),
    contentHash: text("content_hash"),
    detailsHash: text("details_hash"),
    mediaTupleHash: text("media_tuple_hash"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    deploymentContentUnique: uniqueIndex("question_confidentiality_deployment_content_unique").on(
      table.deploymentKey,
      table.frontendAddress,
      table.contentId,
    ),
    deploymentContentIdx: index("question_confidentiality_deployment_content_idx").on(
      table.deploymentKey,
      table.frontendAddress,
      table.contentId,
    ),
    gatedPublishedIdx: index("question_confidentiality_gated_published_idx").on(table.gated, table.publishedAt),
    deploymentGatedPublishedIdx: index("question_confidentiality_deployment_gated_published_idx").on(
      table.deploymentKey,
      table.frontendAddress,
      table.gated,
      table.publishedAt,
    ),
    disclosureIdx: index("question_confidentiality_disclosure_idx").on(table.disclosurePolicy, table.publishedAt),
  }),
);

export type QuestionConfidentiality = typeof questionConfidentiality.$inferSelect;
export type NewQuestionConfidentiality = typeof questionConfidentiality.$inferInsert;

export const confidentialityTermsAcceptances = pgTable(
  "confidentiality_terms_acceptances",
  {
    id: serial("id").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    identityKey: text("identity_key"),
    deploymentKey: text("deployment_key"),
    chainId: integer("chain_id"),
    contentRegistryAddress: text("content_registry_address"),
    frontendAddress: text("frontend_address").notNull(),
    contentId: text("content_id").notNull(),
    termsVersion: text("terms_version").notNull(),
    termsDocHash: text("terms_doc_hash").notNull(),
    payloadHash: text("payload_hash"),
    questionMetadataHash: text("question_metadata_hash"),
    contentHash: text("content_hash"),
    detailsHash: text("details_hash"),
    mediaTupleHash: text("media_tuple_hash"),
    signature: text("signature").notNull(),
    nonce: text("nonce").notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    deploymentWalletContentTermsUnique: uniqueIndex("confidentiality_terms_deployment_wallet_content_terms_unique").on(
      table.deploymentKey,
      table.frontendAddress,
      table.walletAddress,
      table.contentId,
      table.termsVersion,
    ),
    deploymentContentIdentityIdx: index("confidentiality_terms_deployment_content_identity_idx").on(
      table.deploymentKey,
      table.frontendAddress,
      table.contentId,
      table.identityKey,
    ),
    contentIdentityIdx: index("confidentiality_terms_content_identity_idx").on(table.contentId, table.identityKey),
    payloadHashIdx: index("confidentiality_terms_payload_hash_idx").on(table.payloadHash),
  }),
);

export type ConfidentialityTermsAcceptance = typeof confidentialityTermsAcceptances.$inferSelect;
export type NewConfidentialityTermsAcceptance = typeof confidentialityTermsAcceptances.$inferInsert;

export const confidentialContextAccessLogs = pgTable(
  "confidential_context_access_logs",
  {
    id: serial("id").primaryKey(),
    identityKey: text("identity_key"),
    walletAddress: text("wallet_address").notNull(),
    deploymentKey: text("deployment_key"),
    chainId: integer("chain_id"),
    contentRegistryAddress: text("content_registry_address"),
    frontendAddress: text("frontend_address").notNull(),
    contentId: text("content_id").notNull(),
    resourceId: text("resource_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    viewToken: text("view_token").notNull(),
    ipHash: text("ip_hash"),
    viewedAt: timestamp("viewed_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    contentViewedIdx: index("confidential_access_content_viewed_idx").on(table.contentId, table.viewedAt),
    deploymentContentViewedIdx: index("confidential_access_deployment_content_viewed_idx").on(
      table.deploymentKey,
      table.frontendAddress,
      table.contentId,
      table.viewedAt,
    ),
    identityContentIdx: index("confidential_access_identity_content_idx").on(table.identityKey, table.contentId),
    deploymentIdentityContentIdx: index("confidential_access_deployment_identity_content_idx").on(
      table.deploymentKey,
      table.frontendAddress,
      table.identityKey,
      table.contentId,
    ),
    viewTokenUnique: uniqueIndex("confidential_access_view_token_unique").on(table.viewToken),
  }),
);

export type ConfidentialContextAccessLog = typeof confidentialContextAccessLogs.$inferSelect;
export type NewConfidentialContextAccessLog = typeof confidentialContextAccessLogs.$inferInsert;

export const confidentialityBreachReports = pgTable(
  "confidentiality_breach_reports",
  {
    id: serial("id").primaryKey(),
    reporter: text("reporter").notNull(),
    accusedIdentityKey: text("accused_identity_key").notNull(),
    deploymentKey: text("deployment_key"),
    chainId: integer("chain_id"),
    contentRegistryAddress: text("content_registry_address"),
    frontendAddress: text("frontend_address").notNull(),
    contentId: text("content_id").notNull(),
    evidenceUrl: text("evidence_url"),
    evidenceHash: text("evidence_hash").notNull(),
    accessLogId: integer("access_log_id"),
    epoch: text("epoch"),
    proof: text("proof"),
    status: text("status").notNull().default("reported"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    contentStatusIdx: index("confidentiality_breach_content_status_idx").on(table.contentId, table.status),
    deploymentContentStatusIdx: index("confidentiality_breach_deployment_content_status_idx").on(
      table.deploymentKey,
      table.frontendAddress,
      table.contentId,
      table.status,
    ),
    accusedStatusIdx: index("confidentiality_breach_accused_status_idx").on(table.accusedIdentityKey, table.status),
  }),
);

export type ConfidentialityBreachReport = typeof confidentialityBreachReports.$inferSelect;
export type NewConfidentialityBreachReport = typeof confidentialityBreachReports.$inferInsert;

export const confidentialityLogRoots = pgTable(
  "confidentiality_log_roots",
  {
    deploymentKey: text("deployment_key").notNull().default("legacy"),
    frontendAddress: text("frontend_address").notNull(),
    chainId: integer("chain_id"),
    contentRegistryAddress: text("content_registry_address"),
    epoch: text("epoch").notNull(),
    merkleRoot: text("merkle_root").notNull(),
    acceptanceCount: integer("acceptance_count").notNull().default(0),
    accessCount: integer("access_count").notNull().default(0),
    artifactUrl: text("artifact_url"),
    artifactHash: text("artifact_hash"),
    artifactJson: text("artifact_json"),
    anchorChainId: integer("anchor_chain_id"),
    anchorContract: text("anchor_contract"),
    anchorTxHash: text("anchor_tx_hash"),
    anchorPublishedAt: timestamp("anchor_published_at", { mode: "date", withTimezone: true }),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    deploymentEpochPk: primaryKey({
      columns: [table.deploymentKey, table.frontendAddress, table.epoch],
      name: "confidentiality_log_roots_deployment_frontend_epoch_pk",
    }),
    deploymentPublishedIdx: index("confidentiality_log_roots_deployment_published_idx").on(
      table.deploymentKey,
      table.frontendAddress,
      table.publishedAt,
    ),
    publishedIdx: index("confidentiality_log_roots_published_idx").on(table.publishedAt),
    anchorTxIdx: index("confidentiality_log_roots_anchor_tx_idx").on(table.anchorTxHash),
  }),
);

export type ConfidentialityLogRoot = typeof confidentialityLogRoots.$inferSelect;
export type NewConfidentialityLogRoot = typeof confidentialityLogRoots.$inferInsert;

export const imageUploadDailyQuotas = pgTable(
  "image_upload_daily_quotas",
  {
    quotaKey: text("quota_key").primaryKey(),
    subjectKind: text("subject_kind").notNull(),
    subjectId: text("subject_id").notNull(),
    quotaDate: text("quota_date").notNull(),
    imageCount: integer("image_count").notNull().default(0),
    byteCount: numeric("byte_count", { precision: 78, scale: 0 }).default("0").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    subjectDayIdx: index("image_upload_daily_quotas_subject_day_idx").on(
      table.subjectKind,
      table.subjectId,
      table.quotaDate,
    ),
  }),
);

export type ImageUploadDailyQuota = typeof imageUploadDailyQuotas.$inferSelect;
export type NewImageUploadDailyQuota = typeof imageUploadDailyQuotas.$inferInsert;

export const agentSigningIntents = pgTable(
  "agent_signing_intents",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull(),
    chainId: integer("chain_id"),
    clientRequestId: text("client_request_id"),
    paymentMode: text("payment_mode").notNull(),
    walletAddress: text("wallet_address"),
    operationKey: text("operation_key"),
    payloadHash: text("payload_hash"),
    requestBody: text("request_body").notNull(),
    transactionPlan: text("transaction_plan"),
    x402AuthorizationRequest: text("x402_authorization_request"),
    transactionHashes: text("transaction_hashes"),
    error: text("error"),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    tokenHashUnique: uniqueIndex("agent_signing_intents_token_hash_unique").on(table.tokenHash),
    statusExpiresIdx: index("agent_signing_intents_status_expires_idx").on(table.status, table.expiresAt),
    operationKeyIdx: index("agent_signing_intents_operation_key_idx").on(table.operationKey),
  }),
);

export type AgentSigningIntent = typeof agentSigningIntents.$inferSelect;
export type NewAgentSigningIntent = typeof agentSigningIntents.$inferInsert;

export const agentAskHandoffIntents = pgTable(
  "agent_ask_handoff_intents",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull(),
    chainId: integer("chain_id"),
    clientRequestId: text("client_request_id"),
    paymentMode: text("payment_mode").notNull(),
    walletAddress: text("wallet_address"),
    operationKey: text("operation_key"),
    payloadHash: text("payload_hash"),
    requestBody: text("request_body").notNull(),
    originalRequestBody: text("original_request_body").notNull(),
    draftRevision: integer("draft_revision").notNull().default(0),
    preparedDraftRevision: integer("prepared_draft_revision"),
    editedByUser: boolean("edited_by_user").notNull().default(false),
    transactionPlan: text("transaction_plan"),
    transactionHashes: text("transaction_hashes"),
    error: text("error"),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    tokenHashUnique: uniqueIndex("agent_ask_handoff_intents_token_hash_unique").on(table.tokenHash),
    statusExpiresIdx: index("agent_ask_handoff_intents_status_expires_idx").on(table.status, table.expiresAt),
    operationKeyIdx: index("agent_ask_handoff_intents_operation_key_idx").on(table.operationKey),
  }),
);

export type AgentAskHandoffIntent = typeof agentAskHandoffIntents.$inferSelect;
export type NewAgentAskHandoffIntent = typeof agentAskHandoffIntents.$inferInsert;

export const agentAskHandoffAssets = pgTable(
  "agent_ask_handoff_assets",
  {
    id: text("id").primaryKey(),
    handoffId: text("handoff_id").notNull(),
    attachmentId: text("attachment_id").notNull(),
    position: integer("position").notNull().default(0),
    status: text("status").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    imageBase64: text("image_base64").notNull(),
    imageUrl: text("image_url"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    handoffIdx: index("agent_ask_handoff_assets_handoff_idx").on(table.handoffId),
    attachmentUnique: uniqueIndex("agent_ask_handoff_assets_attachment_unique").on(table.attachmentId),
    statusCreatedIdx: index("agent_ask_handoff_assets_status_created_idx").on(table.status, table.createdAt),
  }),
);

export type AgentAskHandoffAsset = typeof agentAskHandoffAssets.$inferSelect;
export type NewAgentAskHandoffAsset = typeof agentAskHandoffAssets.$inferInsert;

export const mcpAgentBudgetReservations = pgTable(
  "mcp_agent_budget_reservations",
  {
    operationKey: text("operation_key").primaryKey(),
    agentId: text("agent_id").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    chainId: integer("chain_id").notNull(),
    categoryId: text("category_id").notNull(),
    paymentAmount: text("payment_amount").notNull(),
    status: text("status").notNull(),
    contentId: text("content_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    agentClientRequestUnique: uniqueIndex("mcp_agent_budget_reservations_client_request_unique").on(
      table.agentId,
      table.chainId,
      table.clientRequestId,
    ),
    agentStatusCreatedIdx: index("mcp_agent_budget_reservations_agent_status_created_idx").on(
      table.agentId,
      table.status,
      table.createdAt,
    ),
  }),
);

export type McpAgentBudgetReservation = typeof mcpAgentBudgetReservations.$inferSelect;
export type NewMcpAgentBudgetReservation = typeof mcpAgentBudgetReservations.$inferInsert;

export const mcpAgentAskAuditRecords = pgTable(
  "mcp_agent_ask_audit_records",
  {
    id: serial("id").primaryKey(),
    operationKey: text("operation_key").notNull(),
    agentId: text("agent_id").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    chainId: integer("chain_id").notNull(),
    categoryId: text("category_id").notNull(),
    paymentAmount: text("payment_amount").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    contentId: text("content_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    agentCreatedIdx: index("mcp_agent_ask_audit_records_agent_created_idx").on(table.agentId, table.createdAt),
    operationCreatedIdx: index("mcp_agent_ask_audit_records_operation_created_idx").on(
      table.operationKey,
      table.createdAt,
    ),
  }),
);

export type McpAgentAskAuditRecord = typeof mcpAgentAskAuditRecords.$inferSelect;
export type NewMcpAgentAskAuditRecord = typeof mcpAgentAskAuditRecords.$inferInsert;

export const mcpAgentDailyBudgetUsage = pgTable(
  "mcp_agent_daily_budget_usage",
  {
    budgetKey: text("budget_key").primaryKey(),
    agentId: text("agent_id").notNull(),
    budgetDate: text("budget_date").notNull(),
    reservedAmount: numeric("reserved_amount", { precision: 78, scale: 0 }).default("0").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    agentDayIdx: index("mcp_agent_daily_budget_usage_agent_day_idx").on(table.agentId, table.budgetDate),
  }),
);

export type McpAgentDailyBudgetUsage = typeof mcpAgentDailyBudgetUsage.$inferSelect;
export type NewMcpAgentDailyBudgetUsage = typeof mcpAgentDailyBudgetUsage.$inferInsert;

export const agentWalletPolicies = pgTable(
  "agent_wallet_policies",
  {
    id: text("id").primaryKey(),
    ownerWalletAddress: text("owner_wallet_address").notNull(),
    agentId: text("agent_id").notNull(),
    agentWalletAddress: text("agent_wallet_address").notNull(),
    status: text("status").notNull(),
    scopes: text("scopes").notNull(),
    categories: text("categories"),
    dailyBudgetAtomic: text("daily_budget_atomic").notNull(),
    perAskLimitAtomic: text("per_ask_limit_atomic").notNull(),
    tokenHash: text("token_hash"),
    tokenIssuedAt: timestamp("token_issued_at", { mode: "date", withTimezone: true }),
    tokenRevokedAt: timestamp("token_revoked_at", { mode: "date", withTimezone: true }),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    ownerAgentUnique: uniqueIndex("agent_wallet_policies_owner_agent_unique").on(
      table.ownerWalletAddress,
      table.agentId,
    ),
    ownerStatusIdx: index("agent_wallet_policies_owner_status_idx").on(
      table.ownerWalletAddress,
      table.status,
      table.updatedAt,
    ),
    agentWalletIdx: index("agent_wallet_policies_agent_wallet_idx").on(table.agentWalletAddress, table.status),
    tokenHashUnique: uniqueIndex("agent_wallet_policies_token_hash_unique").on(table.tokenHash),
  }),
);

export type AgentWalletPolicy = typeof agentWalletPolicies.$inferSelect;
export type NewAgentWalletPolicy = typeof agentWalletPolicies.$inferInsert;

export const agentWalletPolicyAuditRecords = pgTable(
  "agent_wallet_policy_audit_records",
  {
    id: serial("id").primaryKey(),
    policyId: text("policy_id").notNull(),
    ownerWalletAddress: text("owner_wallet_address").notNull(),
    agentId: text("agent_id").notNull(),
    agentWalletAddress: text("agent_wallet_address").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    details: text("details"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    policyCreatedIdx: index("agent_wallet_policy_audit_policy_created_idx").on(table.policyId, table.createdAt),
    ownerCreatedIdx: index("agent_wallet_policy_audit_owner_created_idx").on(table.ownerWalletAddress, table.createdAt),
  }),
);

export type AgentWalletPolicyAuditRecord = typeof agentWalletPolicyAuditRecords.$inferSelect;
export type NewAgentWalletPolicyAuditRecord = typeof agentWalletPolicyAuditRecords.$inferInsert;

export const agentCallbackSubscriptions = pgTable(
  "agent_callback_subscriptions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    callbackUrl: text("callback_url").notNull(),
    secret: text("secret").notNull(),
    eventTypes: text("event_types").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    agentUrlUnique: uniqueIndex("agent_callback_subscriptions_agent_url_unique").on(table.agentId, table.callbackUrl),
    agentStatusIdx: index("agent_callback_subscriptions_agent_status_idx").on(table.agentId, table.status),
  }),
);

export type AgentCallbackSubscription = typeof agentCallbackSubscriptions.$inferSelect;
export type NewAgentCallbackSubscription = typeof agentCallbackSubscriptions.$inferInsert;

export const agentCallbackEvents = pgTable(
  "agent_callback_events",
  {
    id: serial("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    eventId: text("event_id").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    agentId: text("agent_id").notNull(),
    eventType: text("event_type").notNull(),
    callbackUrl: text("callback_url").notNull(),
    secret: text("secret").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date", withTimezone: true }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { mode: "date", withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { mode: "date", withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { mode: "date", withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    eventKeyUnique: uniqueIndex("agent_callback_events_event_key_unique").on(table.eventKey),
    subscriptionEventUnique: uniqueIndex("agent_callback_events_subscription_event_unique").on(
      table.subscriptionId,
      table.eventId,
    ),
    statusNextAttemptIdx: index("agent_callback_events_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
    leaseExpiresIdx: index("agent_callback_events_lease_expires_idx").on(table.leaseExpiresAt),
    agentEventIdx: index("agent_callback_events_agent_event_idx").on(table.agentId, table.eventType),
  }),
);

export type AgentCallbackEvent = typeof agentCallbackEvents.$inferSelect;
export type NewAgentCallbackEvent = typeof agentCallbackEvents.$inferInsert;
