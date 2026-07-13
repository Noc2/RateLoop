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
await client.submitPayment({ operationKey: ask.operationKey }); // prepaid; wallet/x402 include authorization evidence
const state = await client.wait({ operationKey: ask.operationKey });
const result = state.status === "ready" ? await client.result({ operationKey: ask.operationKey }) : null;`}</code>
      </pre>
      <p>
        Ask idempotency keys are required. Pending waits return a cursor, retry delay, expiry, and canonical poll URL.
        Results use schema <code>rateloop.tokenless.v1</code>. API keys are server-only; browser clients authenticate
        with the HttpOnly RateLoop browser session. The result is decision support and must not silently trigger a
        release or be presented as a compliance approval.
      </p>
    </article>
  );
}
