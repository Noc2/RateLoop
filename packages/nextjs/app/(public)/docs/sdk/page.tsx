export default function TokenlessSdkPage() {
  return (
    <article className="prose max-w-none">
      <h1>Tokenless SDK</h1>
      <pre>
        <code>{`import { createTokenlessRateLoopClient } from "@rateloop/sdk";

const client = createTokenlessRateLoopClient({ apiBaseUrl });
const quote = await client.quote(input);
const ask = await client.ask({ quoteId: quote.quoteId, idempotencyKey, payment });
const state = await client.wait({ operationKey: ask.operationKey });
const result = state.status === "ready" ? await client.result({ operationKey: ask.operationKey }) : null;`}</code>
      </pre>
      <p>
        Ask idempotency keys are required. Pending waits return a cursor, retry delay, expiry, and canonical poll URL.
        Results use schema <code>rateloop.tokenless.v1</code>.
      </p>
    </article>
  );
}
