# Claude Workflow Notes

## Production contract deployment notes

- RateLoop smart contracts are already deployed in production on Base mainnet. Treat the deployed contract stack as durable production infrastructure: do not plan or suggest redeploying contracts for routine configuration, environment, indexing, UI, keeper, or operator issues.
- Only consider a production contract redeploy for a significant contract-level defect or larger incident where governance/admin actions, service rewiring, environment updates, or off-chain fixes are insufficient. If redeploy is on the table, spell out why the problem cannot be solved against the existing deployment first.

## Agent image handoff notes

- RateLoop handoff images support JPG, PNG, and WEBP files up to 10 MB per image. Do not downscale or recompress a readable mockup just because base64 output would be too large for the terminal or chat transcript.
- When creating a browser handoff from local/generated images, prefer the file-backed CLI path: `yarn workspace @rateloop/agents handoff --file <ask.json> --image <image.png>`. It reads bytes from disk, computes `sha256`/`sizeBytes`, and stages large files through the handoff blob-upload route instead of squeezing base64 through a single JSON request.
- If using MCP directly, pass image bytes from file-backed tooling or an SDK process. Avoid `cat`, `print`, or shelling base64 into the conversation as the transport layer.
