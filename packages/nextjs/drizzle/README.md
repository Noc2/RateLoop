# Tokenless app migrations

The tokenless branch uses an isolated Postgres database. `0000_tokenless_agent_api.sql` is the baseline and every
subsequent migration recorded in `meta/_journal.json` extends it; no legacy RateLoop tables are required or supported.

Apply the complete ordered journal to the branch database before smoke testing the human-assurance APIs. Hosted
runtimes require the isolated Postgres database and fail closed when it is unavailable. Local tests use explicitly
injected fixtures instead of a product runtime mode.

Isolated Vercel production builds run `yarn workspace @rateloop/nextjs db:migrate:hosted` before compiling. The runner
requires the exact `rateloop-tokenless` project ID and name, serializes migrations with a Postgres advisory lock, and
fails closed when an existing application schema has no journal or its latest migration hash diverges. Preview and
local builds never migrate a database automatically.
