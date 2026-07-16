# Connect an agent workspace

RateLoop's workspace MCP endpoint uses Streamable HTTP and host-native OAuth:

- Name: `rateloop-workspace`
- URL: `https://rateloop-tokenless.vercel.app/api/agent/v1/mcp`
- Download: [`/integrations/rateloop-workspace-mcp.json`](/integrations/rateloop-workspace-mcp.json)

The downloadable JSON uses the common `mcpServers` shape used by compatible MCP clients. It contains no bearer token,
API key, authorization header, or workspace identifier.

After the server is installed, paste the complete single-use RateLoop `/connect/aci_...#...` message into the agent once.
The agent claims the intent, loads its bound policy, and verifies the connection. Installation, trust, organization policy,
and OAuth consent remain controls of the agent host; they cannot be bypassed by a prompt.

The generated Codex message includes both the structured RateLoop plugin mention and an explicit
`$rateloop-workspace-connection` skill invocation. The plugin mention starts installation when RateLoop is missing. The
explicit skill invocation activates the workspace MCP dependency when RateLoop is already installed, so the host can
present any required trust or OAuth action instead of leaving the agent with only the separate public handoff tools.

OAuth approval is a one-time action for the connection attempt. Follow only the continuation, restart, or new-task action
the host actually presents; Codex's structured plugin setup offers **Continue** when same-task resumption is available.
On the next active turn, check for the workspace tools and complete claim, context, and verification. Do not invent a
reload button or settings path, start a second login or nested runtime, or report success before verification. Connection
claim and verification are closed-domain, non-destructive, idempotent MCP actions; publishing and spending remain
separately classified and approval-bound.

Do not put credentials in the MCP configuration. Do not create a background service or polling task to keep a connection
alive.

## Host notes

- Codex and Claude plugin bundles include both the public `rateloop` handoff server and the private
  `rateloop-workspace` server.
- Tokenless workspace connection requires the `0.2.0` or newer RateLoop plugin surface. If a host has the older public-only
  plugin, install from the tokenless-pinned marketplace; do not add a second MCP entry manually. An unpinned
  `Noc2/RateLoop` Git marketplace resolves the separate legacy `main` product.
- Generic clients may import the downloadable URL-only configuration when they support OAuth discovery for Streamable
  HTTP MCP servers.
- A native VS Code manifest will be published only after RateLoop has verified and preregistered its public OAuth client
  ID and redirect behavior. No client ID or redirect URI is guessed in this repository.
- Cursor installation metadata will be published only after its current deep-link format is verified. The repository does
  not emit an unverified install link.
