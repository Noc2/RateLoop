# RateLoop — Next.js (Frontend)

Full-stack web application built with Next.js 15 and React 19. Provides the UI for rating content, question-first submissions with a context URL, off-chain details, image context, or YouTube video context, governed per-question round settings, managing profiles, and reading in-app documentation. Question submissions must attach a non-refundable bounty funded in LREP or USDC. Humans and agents all submit through the same question-first path, and optional identity credentials only unlock one-time onboarding bonuses and launch anchors rather than changing reward weight. The app includes server-side API routes plus a PostgreSQL database via Drizzle ORM.

## Quick Start

```bash
# From the monorepo root:
yarn dev:stack   # Start local Postgres, apply schema, then run Next.js + Ponder, plus Keeper when configured
```

Deployment stays separate, so you can point the app stack at either a local chain or a testnet. For local-chain development, keep `yarn chain` and `yarn deploy` separate. Use `yarn dev:db:down` to stop the local Postgres container when you are done.

## Scripts

Run these from the monorepo root unless noted otherwise:

| Command                                            | Description                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `yarn start`                                       | Start development server (localhost:3000)                                                  |
| `yarn dev:db`                                      | Start the local Postgres container for the Next app                                        |
| `yarn dev:db:down`                                 | Stop the local Postgres container                                                          |
| `yarn dev:db:reset`                                | Reset the local Postgres container and its data volume                                     |
| `yarn dev:stack`                                   | Start local Postgres, apply schema, then run Next.js + Ponder, plus Keeper when configured |
| `yarn next:build`                                  | Production build                                                                           |
| `yarn next:lint`                                   | Run ESLint                                                                                 |
| `yarn next:check-types`                            | TypeScript type checking                                                                   |
| `yarn workspace @rateloop/nextjs format`           | Format frontend code with Prettier                                                         |
| `yarn workspace @rateloop/nextjs db:generate`      | Generate Drizzle migrations                                                                |
| `yarn workspace @rateloop/nextjs db:push`          | Apply migrations to the configured database                                                |
| `yarn workspace @rateloop/nextjs db:studio`        | Open the Drizzle studio UI                                                                 |
| `yarn workspace @rateloop/nextjs whitepaper`       | Generate the whitepaper PDF                                                                |
| `yarn workspace @rateloop/nextjs demo:record`      | Record the short Playwright product demo video                                             |
| `yarn e2e`                                         | Run the default Playwright Chromium app suite                                              |
| `yarn workspace @rateloop/nextjs e2e:ci:lifecycle` | Run lifecycle suites for settlement, cancellation, and dormancy                            |
| `yarn workspace @rateloop/nextjs e2e:ci:keeper`    | Run keeper-backed settlement coverage                                                      |
| `yarn workspace @rateloop/nextjs e2e:full`         | Run the full local Playwright suite, including keeper coverage                             |
| `yarn e2e:ui`                                      | Run E2E tests with interactive Playwright UI                                               |

**Production deploy:** Run `db:push` (or apply SQL migrations) on the Neon app database before shipping signing-intent changes. Migration `0012_agent_signing_intent_prepared_artifacts.sql` adds `transaction_plan` and `x402_authorization_request` columns required for browser signing reload.

CI runs smoke, app, responsive, accessibility, lifecycle, and keeper-backed suites separately on pushes and PRs.

## Demo Recorder

To generate the shortest scripted product walkthrough video, start the local chain, deploy contracts, and run the app stack first:

```bash
yarn chain
yarn deploy
yarn dev:stack
```

Then record the demo:

```bash
yarn workspace @rateloop/nextjs demo:record
```

The recorder saves a `.webm` file under `packages/nextjs/e2e/artifacts/demo/`. Set `RATELOOP_DEMO_HEADLESS=false` if you want to watch the browser while it records, or `RATELOOP_DEMO_VIDEO_PATH=/absolute/path/demo.webm` to override the output file location.

## Configuration

Key environment variables (see `.env.example` for the full list):

| Variable                                               | Description                                                                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_ALCHEMY_API_KEY`                          | Alchemy RPC provider key                                                                                                                                                                     |
| `NEXT_PUBLIC_RPC_URL_31337`                            | Optional browser RPC override for local Foundry                                                                                                                                              |
| `NEXT_PUBLIC_RPC_URL_4801`                             | Optional browser RPC override for World Chain Sepolia                                                                                                                                        |
| `NEXT_PUBLIC_RPC_URL_480`                              | Optional browser RPC override for World Chain mainnet                                                                                                                                        |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`                | Optional WalletConnect project ID for external wallet discovery                                                                                                                              |
| `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`                       | thirdweb client ID for in-app wallets, sponsored transactions, and settings wallet top-ups                                                                                                   |
| `NEXT_PUBLIC_TARGET_NETWORKS`                          | Comma-separated deployed chain IDs exposed in the UI; production builds default to World Chain Sepolia (`4801`) until overridden                                                             |
| `DATABASE_URL`                                         | PostgreSQL URL for the Next app logical database                                                                                                                                             |
| `RESEND_API_KEY`                                       | Resend API key for email notification delivery                                                                                                                                               |
| `RESEND_FROM_EMAIL`                                    | Verified Resend sender address, for example `RateLoop <notifications@info.rateloop.ai>`; use an email address, not a bare domain                                                             |
| `APP_URL`                                              | Public app URL used in verification and email links                                                                                                                                          |
| `NOTIFICATION_DELIVERY_SECRET`                         | Secret for the email delivery cron endpoint                                                                                                                                                  |
| `NEXT_PUBLIC_PONDER_URL`                               | Public Ponder indexer URL (required in production)                                                                                                                                           |
| `THIRDWEB_SERVER_VERIFIER_SECRET`                      | Shared secret used by the thirdweb server verifier webhook                                                                                                                                   |
| `RATELOOP_X402_USDC_ADDRESS`                           | Optional World Chain USDC override for direct agent bounty planning; World Chain mainnet and Sepolia default automatically                                                                   |
| `NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS`      | Optional question reward escrow override while generated deployment metadata catches up; supported chains default from `@rateloop/contracts`                                                 |
| `NEXT_PUBLIC_USDC_ADDRESS`                             | Optional browser-side World Chain USDC override for USDC bounties                                                                                                                            |
| `NEXT_PUBLIC_WORLD_ID_APP_ID`                          | Optional World ID app ID for the settings identity credential                                                                                                                                |
| `NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION`               | Optional World ID credential action ID; defaults to `rateloop-human-credential-v1`                                                                                                           |
| `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT`                     | World ID environment, `production` or `staging`                                                                                                                                              |
| `NEXT_PUBLIC_WORLD_ID_PROOF_MODE`                      | World ID proof mode: `legacy` for v3 launch, `compat` during a future migration, or `v4` after governance upgrades the verifier                                                              |
| `WORLD_ID_RP_ID`                                       | Required for World ID requests; the public IDKit relying-party ID from the World Developer Portal (`rp_...`), used in `rp_context.rp_id`                                                     |
| `WORLD_ID_V4_RP_ID`                                    | Legacy fallback for Next.js only when it contains an `rp_...` ID; prefer `WORLD_ID_RP_ID` in app runtime                                                                                     |
| `WORLD_ID_SIGNING_KEY`                                 | Server-side World ID signing key used only to create short-lived proof requests                                                                                                              |
| `RATELOOP_MCP_AGENTS`                                  | Optional JSON array of managed MCP agents, bearer token hashes, scopes, daily budgets, per-ask caps, wallet addresses, and optional category allowlists                                      |
| `RATELOOP_MCP_ALLOW_UNLIMITED_BUDGET`                  | Static `RATELOOP_MCP_BEARER_TOKEN` ask tokens must set positive daily and per-ask budgets unless this explicit opt-in is `true`; JSON `RATELOOP_MCP_AGENTS` budgets are configured per entry |
| `RATELOOP_MCP_ALLOWED_ORIGINS`                         | Comma-separated browser origins allowed to call `/api/mcp` and `/api/mcp/public`; non-browser agent calls may omit `Origin`                                                                  |
| `FREE_TRANSACTION_LIMIT`                               | Free sponsored app transactions per verified wallet or identity-gated flow (defaults to `25`)                                                                                                |
| `RATE_LIMIT_TRUSTED_IP_HEADERS`                        | Comma-separated proxy IP headers to trust for API rate limiting in production                                                                                                                |
| `KEYSTORE_ACCOUNT`                                     | Optional Foundry keystore name used by the development faucet                                                                                                                                |
| `KEYSTORE_PASSWORD`                                    | Optional password used to decrypt the development faucet keystore                                                                                                                            |
| `DEV_FAUCET_ENABLED`                                   | Enable the development-only LREP, mock USDC, and local identity faucet route                                                                                                                 |
| `FAUCET_PRIVATE_KEY`                                   | Server-side faucet wallet key                                                                                                                                                                |
| `RATELOOP_E2E_PRODUCTION_BUILD`                        | Server-side opt-in for local production-style E2E builds                                                                                                                                     |
| `NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD`            | Browser-side opt-in for local production-style E2E builds                                                                                                                                    |
| `RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET`              | Shared secret required to trigger the internal callback delivery worker at `/api/agent-callbacks/deliver`                                                                                    |
| `BLOB_READ_WRITE_TOKEN`                                | Vercel Blob read-write token used for private image uploads and moderated RateLoop-hosted image delivery. In local development, an empty token uses filesystem-backed uploads instead.       |
| `OPENAI_API_KEY`                                       | OpenAI API key used for automated uploaded-image and question-details moderation in production                                                                                               |
| `RATELOOP_IMAGE_MODERATION_MODE`                       | Optional development override; set to `disabled` only for local testing of the image pipeline                                                                                                |
| `RATELOOP_QUESTION_DETAILS_MODERATION_MODE`            | Optional development override; set to `disabled` only for local testing of the question Details text pipeline                                                                                |
| `RATELOOP_QUESTION_DETAILS_SWEEP_SECRET`               | Bearer/header secret for the question Details sweep route that deletes old blocked or failed Details rows                                                                                    |
| `CRON_SECRET`                                          | Vercel Cron bearer secret accepted by confidentiality disclosure reconciliation and log-root publication jobs                                                                                |
| `RATELOOP_CONFIDENTIALITY_JOB_SECRET`                  | Optional RateLoop-specific bearer/header secret also accepted by confidentiality disclosure reconciliation and log-root publication jobs                                                     |
| `RATELOOP_CONFIDENTIALITY_SECRET`                      | HMAC secret for confidential context IP hashes and view tokens; required in production                                                                                                       |
| `RATELOOP_CONFIDENTIALITY_LOG_ROOT_ARTIFACT_BASE_URL`  | Optional public base URL for deterministic confidentiality log-root artifacts; defaults to `APP_URL` artifact routes                                                                         |
| `RATELOOP_CONFIDENTIALITY_LOG_ROOT_ANCHOR_PRIVATE_KEY` | Optional backend private key that publishes `ConfidentialityEscrow` log-root anchor events; its address needs `ACCESS_RECORDER_ROLE`                                                         |
| `RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR`                  | Optional development directory for filesystem-backed image uploads when `BLOB_READ_WRITE_TOKEN` is empty. Defaults to `.local/image-attachments`.                                            |

Notes:

- Browser RPC reads prefer `NEXT_PUBLIC_RPC_URL_<chainId>` overrides first, then `NEXT_PUBLIC_ALCHEMY_API_KEY`, then the chain's default public RPC list.
- The target-network parser accepts local Foundry plus World Chain Sepolia and mainnet: `31337`, `4801`, and `480`. Production builds use the committed World Chain Sepolia default (`4801`) in `.env.production` unless Vercel/system env config overrides `NEXT_PUBLIC_TARGET_NETWORKS`.
- The Wallet settings tab uses thirdweb's BuyWidget to add native ETH for World Chain gas. Configure the thirdweb client ID's allowed domains for the production and preview origins that will render `/settings#wallet`.
- The Identity settings tab uses World ID v3 legacy proofs by default. The connected wallet submits the proof directly to `RaterRegistry.attestHumanCredentialWithProof`, where the World ID router checks it on-chain before any credential exists. The v4 proof parser and contract hook remain available for a future governance upgrade behind `NEXT_PUBLIC_WORLD_ID_PROOF_MODE`.
- Bounties can stay open to everyone or require Proof of Human. Passport, Selfie Check, and recent-recheck bounty scopes are hidden for the v3 launch.
- To enable verified launch claims and referral payouts, deploy `RaterRegistry` with the same World ID app/action configured in the frontend. Rating, rewards, and governance remain usable without this optional credential.
- The proof signal is always derived from the connected wallet address, so a World ID proof cannot be replayed onto another wallet.
- `/api/mcp/public` exposes tokenless quote, ask, image upload, confirm, status, result, template, and category tools for agents that already control a funded wallet. `/api/mcp` remains the managed endpoint for bearer-token policies, balances, signed callbacks, and audit surfaces.
- Cross-package env naming (USDC aliases, E2E flags, contract address prefixes): [`docs/env-parity.md`](../../docs/env-parity.md).
- Agent clients should follow the AI docs flow: list templates, quote with `walletAddress`, create a browser handoff for human-funded asks or execute wallet calls for funded agent wallets, wait for status or signed managed callbacks, then fetch the structured result. `/ask?tab=agent` is Agent Access: a control panel for wallet funding plus optional operator-managed tokens, scopes, budgets, category allowlists, callback recovery, and audit history; static `RATELOOP_MCP_AGENTS` remains supported for server-configured policies.
- The Ask page and MCP tools can host JPG, PNG, and WEBP image context through private Vercel Blob uploads, using the same 10 MB per-image limit for users and agents. Uploaded images are validated, metadata-stripped into WEBP, moderated with OpenAI, and served through `/api/attachments/images/{attachmentId}.webp` only after approval. Agents that generate or capture image bytes should pass original under-limit bytes through `generatedImages` in browser handoffs, call `rateloop_upload_image` directly with a managed token, or call `rateloop_prepare_image_upload` plus `rateloop_upload_image` in public wallet mode, instead of asking users to find a third-party image host. Agents should read image bytes directly from disk in their tool/SDK process rather than copying base64 from terminal output.
- The Ask page hosts written question context as off-chain Details. Approved Details are UTF-8 normalized, moderated with OpenAI, exposed as `text/plain` at `/api/attachments/details/{detailsId}`, and committed on-chain through `detailsUrl` plus `detailsHash` so other frontends can fetch and verify the full text.
- Private context is live for RateLoop-hosted images/details behind wallet-signed confidentiality terms, access logs, watermarking, optional rater bonds, and disclosure policies. Omitted gated disclosure policy defaults to `private_forever`; `after_settlement` is available when the asker wants hosted context disclosed after settlement. This is a serving-layer deterrence model rather than cryptographic secrecy: operators can serve/read hosted bytes, and eligible raters can still absorb what they see.
- No core contract address env vars are needed for supported chains. The frontend reads core deployment metadata from `@rateloop/contracts` and fails fast if `NEXT_PUBLIC_TARGET_NETWORKS` includes a chain without those definitions. Rollout contracts such as question reward pools can use their documented env fallbacks until generated metadata catches up.
- In production, the intended setup is one Railway Postgres service with separate logical databases for Ponder and Next.js.
- If your Postgres provider terminates TLS with a private or self-signed chain, append `uselibpqcompat=true&sslmode=require` to `DATABASE_URL` to opt out of the app's default `verify-full` normalization.
- For local development, `yarn dev:db` and `yarn dev:stack` manage a Docker Postgres container when `DATABASE_URL` points to localhost. `yarn dev:stack` only runs `db:push` automatically for local databases; non-local databases require a manual `yarn workspace @rateloop/nextjs db:push` or `yarn dev:stack --allow-remote-db-push`.
- On Next.js 15, `NextRequest.ip` is not reliably populated. On non-Vercel production hosts you must configure `RATE_LIMIT_TRUSTED_IP_HEADERS` to the header(s) your hosting proxy overwrites. Vercel auto-trusts `x-real-ip`, and localhost shortcuts are only enabled for development or explicit local production-style E2E builds. Protected API routes fail closed when no trusted client IP can be derived or when the rate-limit store is unavailable.
- The free transaction quota is enforced by the thirdweb server verifier route at `/api/thirdweb/verify-transaction`. Configure the same secret in thirdweb’s dashboard and in `THIRDWEB_SERVER_VERIFIER_SECRET`.
- The old x402 question route has been removed. Paid agent asks use ordered wallet calls or native x402-style USDC authorizations that fund protocol escrow directly; no legacy RateLoop executor, custody path, saved policy token, or separate service fee is part of the default ask flow. USDC-funded asks do not require identity verification.
- The Next.js dev faucet reads `KEYSTORE_ACCOUNT`/`KEYSTORE_PASSWORD` or `FAUCET_PRIVATE_KEY` from `packages/nextjs/.env.local`. Keeper wallet settings live separately in `packages/keeper/.env.local`.

## Project Structure

```text
app/                          # Next.js App Router
├── api/                      # Server-side API routes
├── docs/                     # In-app documentation
├── ask/, rate/               # Question asking and rating flows
└── profiles/, settings/      # User profile and preference routes

components/                   # React components
├── content/embeds/           # Media embeds
├── home/, leaderboard/       # Home and leaderboard UIs
├── profile/, submit/, vote/  # Feature-specific flow components
├── shared/, ui/              # Shared presentation primitives
└── scaffold-eth/             # Wallet and contract interaction components

hooks/                        # Custom React hooks
├── scaffold-eth/             # useScaffoldReadContract, useScaffoldWriteContract, etc.
├── usePonderQuery.ts         # Shared indexed-data fetch helper
├── useRoundSnapshot.ts       # Shared active-round contract read + derived state
└── useVotingConfig.ts        # Shared voting config contract read

services/ponder/client.ts     # REST client for the Ponder indexer API
services/web3/                # wagmi config and wallet connector setup
lib/db/schema.ts              # Drizzle ORM database schema
lib/notifications/            # Email preference and delivery logic
lib/agent/                    # Agent result packages and off-chain template metadata
lib/mcp/                      # Public and managed MCP auth, budgets, and tool handlers
utils/platforms/handlers/     # Platform detection and URL parsing
scaffold.config.ts            # Target networks, Alchemy/WalletConnect config
```

## Architecture

The frontend reads on-chain data in two ways:

1. **Wagmi/Scaffold-ETH hooks** — direct contract reads and writes via the user's wallet
2. **Ponder API** — indexed historical data fetched through `services/ponder/client.ts`

Shared contract ABIs and deployment metadata come from the `@rateloop/contracts` workspace package.

Uses the `~~/*` path alias for imports from the project root. All client components require the `"use client"` directive.
