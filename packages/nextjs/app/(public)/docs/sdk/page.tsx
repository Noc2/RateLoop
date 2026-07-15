export default function SdkPage() {
  return (
    <article className="prose max-w-none">
      <h1>RateLoop SDK</h1>
      <p>
        Add a paid human-assurance panel to a workflow when an AI-enabled output needs a defined quality gate before
        rollout.
      </p>
      <p>
        The currently deployed preview runs with TOKENLESS_SANDBOX_MODE=true. Use only public, synthetic, or safely
        redacted inputs and do not treat its responses as live human evidence.
      </p>
      <pre>
        <code>{`import { createTokenlessRateLoopClient } from "@rateloop/sdk";

const client = createTokenlessRateLoopClient({ apiBaseUrl, apiKey });
const quote = await client.quote(input);
const ask = await client.ask({ quoteId: quote.quoteId, idempotencyKey, payment });
const instructions = await client.paymentInstructions({ operationKey: ask.operationKey });
// Prepaid: submitPayment({ operationKey: ask.operationKey });
// x402: build and validate the authorization locally, then submit it.
await client.submitPayment({ operationKey: ask.operationKey, authorization });
const state = await client.wait({ operationKey: ask.operationKey });
const result = state.status === "ready" ? await client.result({ operationKey: ask.operationKey }) : null;`}</code>
      </pre>
      <p>
        Ask idempotency keys are required. Autonomous publishing uses the credential and policy created by the approved
        agent connection flow; RateLoop does not expose separate manual credential setup. The SDK remains
        wallet-agnostic and never stores private keys. Payment instructions include the versioned x402 authorization
        facts needed by a separate signer. Pending waits return a cursor, retry delay, expiry, and canonical poll URL.
        Results use schema
        <code>rateloop.tokenless.v2</code>. Browser clients authenticate with the HttpOnly RateLoop browser session. The
        result is decision support and must not silently trigger a release or be presented as a compliance approval.
      </p>
      <h2>Identity and authorization boundary</h2>
      <p>
        Browser identity is separate from the SDK: Better Auth resolves an opaque RateLoop principal and a wallet is
        optional. Server integrations use scoped, revocable API keys. RateLoop derives their workspace and authorized
        client/project assignment; a caller-supplied tenant ID or wallet address is not an authorization signal.
      </p>
      <p>
        EU-first repository checks do not establish verified EU hosting or certification. Use{" "}
        <a href="/trust">the trust registry</a> for current claim status and external gates.
      </p>
    </article>
  );
}
