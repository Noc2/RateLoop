# Connect an agent workspace

RateLoop's workspace MCP endpoint uses Streamable HTTP and host-native OAuth:

- Name: `rateloop-workspace`
- URL: `https://rateloop-tokenless.vercel.app/api/agent/v1/mcp`
- Download: [`/integrations/rateloop-workspace-mcp.json`](/integrations/rateloop-workspace-mcp.json)

The downloadable JSON is the URL-only configuration used by the bundled Codex and Claude plugins. MCP does not define
a universal client configuration file: VS Code uses `servers`, Gemini CLI uses `mcpServers` with `httpUrl`, and hosted
APIs use application-managed authorization. The download contains no bearer token, API key, authorization header, or
workspace identifier. Use the primary Codex path or one named configuration below instead of renaming fields by guess.

After the server is installed, paste the complete single-use RateLoop `/connect/aci_...#...` message into the agent once.
The preferred `rateloop_connect_workspace` tool claims the intent, loads its bound policy, and verifies the connection in
one resumable call. Installation, trust, organization policy, and OAuth consent remain controls of the agent host; they
cannot be bypassed by a prompt.

Installing the server does not start a background reviewer and does not make an already-running task call RateLoop. The
active task must expose the workspace tools. A new connection prefers `rateloop_connect_workspace`; only when that tool
is unavailable does it use `rateloop_claim_connection_intent`, `rateloop_get_agent_context`, then
`rateloop_verify_connection`. Do not report the workspace connected until either path returns successful verification.
Before every eligible output, the agent reloads context and calls `rateloop_evaluate_review_requirement`. A required review then follows
`rateloop_request_review -> rateloop_wait_for_review -> rateloop_get_review_result` within the exact authority returned
by the workspace.

Workspace owners inspect and change audience, frequency, response window, panel, compensation, and agent authority
directly in **Reviews**. When multiple agents are active, a compact selector chooses which agent's policy to edit; the
workspace reviewer roster follows the editor. A saved policy change does not require a new intent; the next context read
returns the active version. A new intent is required after deletion or revocation.

The generated Codex message includes both the structured **RateLoop Workspace** plugin mention and an explicit
`$rateloop-workspace-connection` skill invocation. This dedicated plugin contains only the OAuth-protected workspace MCP
server, so the host must activate the correct connection instead of silently falling back to RateLoop's separate public
handoff tools. Its marketplace entry authenticates during installation rather than first use, so a fresh connection task
normally starts only after OAuth is complete and can see the protected tools immediately. The same message works for a
first connection and after a previous workspace has been deleted.

OAuth approval is a one-time action for the connection attempt. Existing or revoked plugin installations can still need
host reauthorization. Follow only the continuation, restart, or new-task action the host actually presents; Codex's
structured plugin setup offers **Continue** when same-task resumption is available.
Treat the first missing-tool check as activation pending, including when the task resumed after host setup. On the next
active turn, check again and use the one-call connector when the tools appear, with claim, context, and verification as
its granular fallback. Do not invent a reload button or settings path, start a second login or nested runtime, or report
success before verification. Connection operations are closed-domain, non-destructive, idempotent MCP actions;
publishing and spending remain separately classified and approval-bound.

### Authentication finished, but still waiting?

A host page that says **Authentication complete** confirms the OAuth callback, not a verified RateLoop workspace
connection. Return to the same task and use **Continue** if offered. Only if the protected tools are still missing on a
later active turn and the host offers no native action should you uninstall every existing RateLoop plugin, including
`rateloop` and `rateloop-workspace`. Then resume the same task with the original connection message. Do not remove
unrelated plugins or create a replacement link.

### Codex is connected to another workspace

One Codex OAuth connection can have only one active RateLoop workspace binding. Reconnect an existing agent from its
RateLoop connection screen; do not reuse an older untargeted connection message. The targeted reconnect uses two
explicit decisions and never exposes or replaces the bearer credential:

1. The agent reports: **Moving this Codex connection will disconnect it from its current RateLoop workspace and replace
   the selected agent’s previous connection.** The current credential holder must explicitly confirm that consequence
   in the agent task.
2. RateLoop then gives the selected agent’s workspace owner a website approval. The owner approves or denies the move
   while signed in to RateLoop.
3. After approval, the agent retries the same privately preserved connection URL. RateLoop moves the one active binding,
   invalidates the replaced sessions, preserves the selected agent and its saved review configuration, and verifies the
   connection.

The agent cannot approve the owner’s website decision, and the owner’s approval cannot substitute for the credential
holder’s confirmation. Neither surface reveals the other workspace’s identity. If RateLoop instead reports the legacy
`workspace_conflict`, create a targeted reconnect message for the intended agent and retry in the same task. Do not
claim an invisible OAuth prompt is pending, copy the connection secret again, expose a workspace identifier, handle a
bearer token, or change MCP configuration.

Do not put credentials in the MCP configuration. Do not create a background service or polling task to keep a connection
alive.

## Other MCP clients and support tiers

RateLoop classifies the **host or integration** separately from the model. A model still needs reliable tool use, but the
host owns MCP transport, OAuth, tool-result handling, approval UI, and session lifecycle. The syntax below was checked
against the named vendors' documentation on 2026-07-17. Except where a row says **Verified**, that does not replace an
end-to-end RateLoop install, authorization, lifecycle, and tool smoke test against a named client version.

| Tier                | Meaning                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Verified            | RateLoop runs release-gated install, authorization, lifecycle, and tool smoke tests against a named client version.   |
| Protocol-compatible | The client documents Streamable HTTP and compatible OAuth, but RateLoop has not completed that release smoke test.    |
| Application-managed | An SDK or hosted API can connect only after the embedding application obtains, refreshes, and supplies authorization. |
| Public MCP only     | The host can use the separate unauthenticated browser-handoff server but cannot complete protected workspace OAuth.   |
| Unsupported         | The host lacks remote HTTP MCP, OAuth, tool calling, or a required policy control.                                    |

No protected-workspace host is yet in the **Verified** tier. The official MCP conformance runner has verified the public
server's initialize and four-tool discovery path; it did not exercise an authenticated workspace connection.

| Host or integration                                  | Current tier                      | Notes                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex desktop with the RateLoop Workspace plugin     | Protocol-compatible; primary path | Bundled plugin, skill, and local contracts are tested. Add an installed-host release smoke test before naming a Codex version Verified.       |
| Claude Code                                          | Protocol-compatible               | Remote HTTP OAuth is documented. Direct registration below does not install RateLoop's Claude hooks or make the host an enforcement boundary. |
| GitHub Copilot Chat in local VS Code                 | Protocol-compatible               | This is the IDE client, not GitHub's cloud agent. RateLoop has not preregistered or guessed a VS Code OAuth client ID or redirect URI.        |
| Gemini CLI                                           | Protocol-compatible               | Streamable HTTP, OAuth discovery, DCR, and server instructions are documented; its JSON transport field is `httpUrl`.                         |
| OpenAI or Anthropic hosted MCP, and SDK integrations | Application-managed               | The embedding application owns token acquisition, refresh, storage, and injection. This is not the interactive plugin flow.                   |
| GitHub Copilot cloud agent and code review           | Public MCP only                   | GitHub currently documents no support for remote OAuth MCP servers, so the protected workspace endpoint is unavailable.                       |
| Non-tool-capable chat host                           | Unsupported                       | Model quality cannot substitute for an MCP agent loop.                                                                                        |

### Claude Code

Register the protected server at user scope, open Claude Code, run `/mcp`, and complete the browser authorization before
pasting the single-use connection message:

```sh
claude mcp add --scope user --transport http rateloop-workspace https://rateloop-tokenless.vercel.app/api/agent/v1/mcp
```

This is the generic remote-server path. It does not install the repository's separate Claude plugin hooks or prove that
Claude held an output. See [Anthropic's remote MCP and OAuth instructions](https://docs.anthropic.com/en/docs/claude-code/mcp).

### GitHub Copilot Chat in local VS Code

Put the protected server in the local IDE's user or workspace `mcp.json`, start it, then use VS Code's **Auth** action
when it appears:

```json
{
  "servers": {
    "rateloop-workspace": {
      "type": "http",
      "url": "https://rateloop-tokenless.vercel.app/api/agent/v1/mcp"
    }
  }
}
```

Do not add an invented `oauth.clientId` or redirect URI. If organization policy blocks MCP or authorization cannot be
completed, prompts cannot bypass that control. This configuration is for
[Copilot Chat in local VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration), not GitHub's
cloud agent or code review.

### Gemini CLI

Register the protected server at user scope, start Gemini CLI, then run `/mcp auth rateloop-workspace` if authentication
is required:

```sh
gemini mcp add --scope user --transport http rateloop-workspace https://rateloop-tokenless.vercel.app/api/agent/v1/mcp
```

The equivalent `settings.json` entry uses `httpUrl`, not `url` plus `type`:

```json
{
  "mcpServers": {
    "rateloop-workspace": {
      "httpUrl": "https://rateloop-tokenless.vercel.app/api/agent/v1/mcp"
    }
  }
}
```

Keep `trust` at its default `false` so tool confirmations remain available. See
[Gemini CLI's Streamable HTTP and OAuth guidance](https://geminicli.com/docs/tools/mcp-server/).

### Hosted APIs and GitHub cloud agents

OpenAI and Anthropic hosted MCP connectors are application-managed: the caller must obtain and supply authorization and
must not place tokens in prompts or static public configuration. GitHub Copilot cloud agent and code review are a
different product from local Copilot Chat; GitHub currently documents that they cannot connect to a remote OAuth MCP
server. They may use only RateLoop's separate public browser-handoff endpoint at
`https://rateloop-tokenless.vercel.app/api/mcp` when repository policy and the public-data boundary allow it.

Cursor or another host should not be presented with an install link, client ID, redirect URI, or copied JSON until that
exact setup has been checked against its current vendor documentation and exercised in a RateLoop release smoke test.

For the agent-readable packet fields, export routes, local verification commands, framework cross-references, and exact
non-claims, read [`evidence.md`](./evidence.md). The browser version is [`/docs/evidence`](/docs/evidence).
Framework-native LangGraph, OpenAI Agents, Claude Code, and MCP elicitation contracts are documented in
[`framework-integrations.md`](./framework-integrations.md).

Generic MCP and ordinary Codex hooks are advisory: the host can bypass them and they do not prove that output remained
blocked. Only a verified adapter that owns the downstream output boundary and validates RateLoop's signed evidence may
be described as host-enforced.

Deleting a RateLoop workspace revokes its OAuth token family, access tokens, refresh tokens, connection intent, and agent
integration. On the next RateLoop Workspace invocation, the protected MCP server should return the standard OAuth
authorization challenge so the host can request fresh consent. If no protected tools or native action appears, use the
stale-plugin recovery above.

## Host notes

- Codex and Claude use separate plugin bundles: `rateloop` contains only public human-assurance tools, while
  `rateloop-workspace` contains the private workspace server and connection skill.
- Install both plugins from the tokenless-pinned marketplace when both workflows are needed; do not add a second MCP entry
  manually. An unpinned `Noc2/RateLoop` Git marketplace resolves the separate legacy `main` product.
- Do not present the downloadable plugin configuration as universal client JSON; use the named client syntax above.
- A native VS Code manifest will be published only after RateLoop has verified and preregistered its public OAuth client
  ID and redirect behavior. No client ID or redirect URI is guessed in this repository.
- Cursor installation metadata will be published only after its current deep-link format is verified. The repository does
  not emit an unverified install link.
