# Claude Workflow Notes

Claude should use [`AGENTS.md`](AGENTS.md) as the source of truth for repository
workflow, governance rotation, image handoff, and audit trust-model guidance.

Production smart contract rule: RateLoop smart contracts are deployed in production.
Do not change Solidity contracts, contract deployment wiring, or generated contract
artifacts/ABIs as routine product work. Contract changes should happen only through
the appropriate governance process, or for an urgent production/security issue that
justifies emergency handling.
