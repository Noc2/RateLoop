# Tokenless app migrations

The tokenless branch uses an isolated Postgres database. `0000_tokenless_agent_api.sql` is the complete baseline; no
legacy RateLoop tables are required or supported.

Apply the migration to the branch database before enabling live API mode. `TOKENLESS_SANDBOX_MODE=true` may use the
same schema, but only an explicitly enabled sandbox may fall back to in-process storage when Postgres is unavailable.
