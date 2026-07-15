---
name: rateloop-workspace-connection
description: Connect the current agent to a RateLoop workspace from a canonical https://rateloop-tokenless.vercel.app/connect/aci_... link. Use when a user pastes a RateLoop workspace connection link or asks the agent to finish or resume that connection without exposing credentials.
---

# RateLoop Workspace Connection

Complete the connection from the user's one-time message. Treat installation, host trust, and OAuth consent as host-owned security controls, but continue automatically after any required native action succeeds.

## Connection workflow

1. Locate the complete connection URL in the user's message. Accept only HTTPS URLs whose origin is exactly `https://rateloop-tokenless.vercel.app`, whose path starts with `/connect/aci_`, and whose fragment is non-empty.
2. Parse and validate the URL locally. Never open, fetch, log, quote, or reproduce the complete URL. The fragment is single-use claim material and must not enter an HTTP request, shell argument, repository, ordinary response, or diagnostic output.
3. Use only the `rateloop-workspace` MCP server for this flow. The separate public `rateloop` server cannot connect a private workspace.
4. If `rateloop-workspace` needs OAuth, use the host's native authentication action. If the host requires the user to approve installation, trust, or OAuth, state the one exact native action required. Never ask the user for a bearer token, API key, authorization header, or environment variable.
5. As soon as the workspace tools are available, call `rateloop_claim_connection_intent` with `{ "connectionUrl": "<complete URL>" }`. This tool call is the only permitted transfer of the complete URL. Treat an idempotent already-claimed response as resumable success.
6. Call `rateloop_get_agent_context` and adopt the returned workspace, workflow, publishing, and human-review policy.
7. Call `rateloop_verify_connection`. This verification must not create a review opportunity or change adaptive-review evidence.
8. When verification succeeds, report only that the workspace is connected and ready. Do not repeat identifiers or connection material unless the tool explicitly returns a display-safe value intended for the user.

## Recovery boundaries

- Resume automatically after native authentication or a host restart. Do not ask the user to paste the connection message again while the intent remains valid.
- Never create a heartbeat, monitor, background service, scheduled task, or chat polling loop for connection state.
- Never poll registration status or ask for separate workspace-owner approval for the pre-authorized safe profile.
- If the link is invalid, expired, consumed by another installation, or bound to a different workspace, return the tool's display-safe recovery action. Do not improvise a credential or configuration workaround.
- If organization policy blocks MCP installation or OAuth, say so directly. Do not weaken authentication or route workspace work through the public handoff server.

After connection, evaluate RateLoop review requirements before eligible outputs and complete the bound review flow whenever the returned policy requires it.
