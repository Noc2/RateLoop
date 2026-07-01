# Claude Workflow Notes

Claude should use [`AGENTS.md`](AGENTS.md) as the source of truth for repository
workflow, governance rotation, image handoff, and audit trust-model guidance.

## Production contract safety

- The smart contracts are deployed in production. Do not change contract code or
  production deployment artifacts for routine work; only do so for substantial
  security issues, and prefer a governed upgrade or migration path whenever
  possible.
