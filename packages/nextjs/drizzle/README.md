# Drizzle migrations

SQL migrations in this directory are the source of truth for the Next.js app database schema. Apply them with:

```bash
yarn workspace @rateloop/nextjs db:push
```

## Deploy checklist

| Migration | Required for |
| --- | --- |
| `0012_agent_signing_intent_prepared_artifacts.sql` | Browser signing-intent prepare/reload (`transaction_plan`, `x402_authorization_request`) |
| `0013_watchlist_notifications_deployment_scope.sql` | Watchlist writes/reads and watched-content notification delivery on chain-scoped deployments (`deployment_key`, `chain_id`, `content_registry_address`) |

The Drizzle meta snapshot (`meta/0000_snapshot.json`) may lag behind applied migrations; rely on `schema.ts` and numbered SQL files when auditing drift. Regenerate snapshots with `db:generate` after intentional schema edits.
