# Tokenless app migrations

The tokenless branch uses an isolated Postgres database. `0000_tokenless_agent_api.sql` is the baseline and every
subsequent migration recorded in `meta/_journal.json` extends it; no legacy RateLoop tables are required or supported.

Apply the complete ordered journal to the branch database before smoke testing the human-assurance APIs or enabling
live API mode. `TOKENLESS_SANDBOX_MODE=true` may use the
same schema, but only an explicitly enabled sandbox may fall back to in-process storage when Postgres is unavailable.
