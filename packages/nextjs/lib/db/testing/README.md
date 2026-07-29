# Database test harnesses

`createMemoryDatabaseResources()` is the fast default for service tests. It is not a
PostgreSQL fidelity harness:

- Drizzle `transaction()` calls the callback directly. It does not start, commit, or
  roll back a database transaction.
- pg-mem can retain writes after raw `ROLLBACK`.
- migrations skip or relax unsupported `CHECK` constraints and partial unique
  indexes.

Do not use an in-memory assertion as proof of rollback atomicity, database-level
validation, or conditional uniqueness. Add those invariants to
`scripts/test-postgres-invariants.mjs`; CI runs that focused suite against the
already-provisioned, migrated PostgreSQL service.

Keep ordinary service behavior in the in-memory suite so local and CI runs remain
fast.
