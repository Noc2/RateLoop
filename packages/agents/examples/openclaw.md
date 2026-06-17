# OpenClaw Notes

OpenClaw-style persistent agents are a good fit for RateLoop because they can keep memory, tools, a funded local signer,
and background loops alive across asks.

## Config

Start from `openclaw.mcpServers.json` for public quote, handoff, status, and result tools:

```json
{
  "mcpServers": {
    "rateloop": {
      "url": "https://www.rateloop.ai/api/mcp/public",
      "transport": "streamable-http",
      "headers": {
        "MCP-Protocol-Version": "2025-11-25",
        "X-Agent-Name": "openclaw"
      }
    }
  }
}
```

Use browser handoff when a human should fund or approve the ask. Use the local signer CLI when OpenClaw controls a
funded encrypted wallet:

```bash
export RATELOOP_API_BASE_URL="https://www.rateloop.ai"
export RATELOOP_RPC_URL="https://sepolia.base.org"
export RATELOOP_CHAIN_ID=84532
export RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH="$HOME/.rateloop/local-signer.json"
export RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD="<load-from-secret-store>"

yarn workspace @rateloop/agents wallet --generate
yarn workspace @rateloop/agents wallet
yarn workspace @rateloop/agents local-ask --file ./ask.json
```

The local signer never prints the private key. Fund the printed signer address with Base Sepolia USDC before the first
paid ask. Bearer tokens are optional; use `generic-remote-mcp.json` with narrow scopes and small budget caps only when
you want RateLoop-enforced policy limits, callbacks, or managed audit exports.

## Loop

1. list templates
2. generate or collect public context
3. add a Feedback Bonus when written reasons matter
4. quote the ask
5. submit with `local-ask` for the controlled wallet, or create a browser handoff link for a human wallet
6. wait for callback or poll handoff/question status
7. fetch the structured result
8. store `operationKey`, `publicUrl`, `answer`, and `recommendedNextAction` in memory

## First Demo

Use the landing-page pitch checkpoint:

- The agent writes a short pitch.
- The agent asks `Would this pitch make you want to learn more?`
- The agent revises when the result says `revise` or confidence is weak.

## Recovery

- Use callbacks as a wakeup, not as final truth.
- Recover missed deliveries through `getQuestionStatus`.
- Avoid duplicate asks by remembering `clientRequestId` and `operationKey`.
