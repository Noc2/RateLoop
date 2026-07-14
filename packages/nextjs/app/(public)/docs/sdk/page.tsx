export default function SdkPage() {
  return (
    <article className="prose max-w-none">
      <h1>RateLoop SDK</h1>
      <p>
        Add a paid human-assurance panel to a workflow when an AI-enabled output needs a defined quality gate before
        rollout.
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
        Ask idempotency keys are required. Autonomous publishing requires a policy-bound workspace API key; the SDK
        remains wallet-agnostic and never stores private keys. Payment instructions include the versioned x402
        authorization facts needed by a separate signer. Pending waits return a cursor, retry delay, expiry, and
        canonical poll URL. Results use schema <code>rateloop.tokenless.v1</code>. Browser clients authenticate with the
        HttpOnly RateLoop browser session. The result is decision support and must not silently trigger a release or be
        presented as a compliance approval.
      </p>
    </article>
  );
}
