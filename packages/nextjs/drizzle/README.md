# Tokenless app migrations

The tokenless branch uses an isolated Postgres database. `0000_tokenless_agent_api.sql` is the baseline and every
subsequent migration recorded in `meta/_journal.json` extends it; no legacy RateLoop tables are required or supported.

Apply the complete ordered journal to the branch database before smoke testing the human-assurance APIs or enabling
live API mode. `TOKENLESS_SANDBOX_MODE=true` may use the
same schema, but only an explicitly enabled sandbox may fall back to in-process storage when Postgres is unavailable.

Isolated Vercel production builds run `yarn workspace @rateloop/nextjs db:migrate:hosted` before compiling. The runner
requires the exact `rateloop-tokenless` project ID and name, serializes migrations with a Postgres advisory lock, and
fails closed when an existing application schema has no journal or its latest migration hash diverges. Preview and
local builds never migrate a database automatically.
