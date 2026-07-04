# Gemini CLI Notes

Gemini CLI and similar local coding agents work well with the same remote MCP server used by persistent agents.

## Config

Start from `gemini-cli.mcpServers.json` for public quote, handoff, status, and result tools. For a human-controlled wallet, create a browser handoff link instead of exposing raw wallet calls. Use a managed bearer token only when you want saved RateLoop policy caps, callbacks, balance tooling, or audit exports:

```json
{
  "mcpServers": {
    "rateloop": {
      "httpUrl": "https://www.rateloop.ai/api/mcp/public",
      "headers": {
        "MCP-Protocol-Version": "2025-11-25"
      }
    }
  }
}
```

If your local runtime expects a generic `url` + `transport` shape instead of Gemini CLI's `httpUrl`, use `generic-public-mcp.json` as the tokenless baseline and `generic-remote-mcp.json` as the managed baseline.

## Usage Pattern

- Quote first.
- Prefer a browser handoff link for human wallets, or the local signer CLI for agent-controlled wallets.
- Ask humans only when the agent is genuinely uncertain or the decision matters.
- Poll `rateloop_get_handoff_status` for browser handoffs, then `rateloop_get_question_status` until the ask is ready or terminal.
- Fetch the settled package with `rateloop_get_result`.
- Store the returned `publicUrl` in the task log so later steps can cite the human checkpoint.

## Good Local Demos

- Rate README opening A for clarity, then rate README opening B in the same ranked bundle.
- Would this landing-page pitch make you want to learn more?
- Rate UI copy variant A for credibility, then rate variant B in the same ranked bundle.
