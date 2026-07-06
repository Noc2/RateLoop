# Drizzle migrations

Numbered SQL migrations in this directory are the source of truth for the Next.js app database schema in migration-file deploys. Apply them through the project or host SQL migration process before shipping database-backed app changes.

`yarn workspace @rateloop/nextjs db:push` runs Drizzle schema synchronization against the configured database. Use it for controlled local or development environments; it does not execute the numbered SQL migration files in this directory.

## Deploy checklist

| Migration | Required for |
| --- | --- |
| `0012_agent_signing_intent_prepared_artifacts.sql` | Browser signing-intent prepare/reload (`transaction_plan`, `x402_authorization_request`) |
| `0013_watchlist_notifications_deployment_scope.sql` | Watchlist writes/reads and watched-content notification delivery on chain-scoped deployments (`deployment_key`, `chain_id`, `content_registry_address`) |
| `0016_free_transaction_reservation_session_token.sql` | Free-transaction confirm session binding (`reservation_session_token` on pending reservations) |
| `0018_agent_handoff_feedback_bonus_recovery.sql` | Browser handoff Feedback Bonus confirmation retry state after bonus wallet calls are broadcast |
| `0019_current_deployment_scope_only.sql` | Current-deployment-only watchlist/confidentiality persistence; prunes legacy unscoped rows and removes fallback defaults |

The Drizzle meta snapshot (`meta/0000_snapshot.json`) may lag behind applied migrations; rely on `schema.ts`, numbered SQL files, and `meta/_journal.json` when auditing drift. Regenerate snapshots with `db:generate` after intentional schema edits.
