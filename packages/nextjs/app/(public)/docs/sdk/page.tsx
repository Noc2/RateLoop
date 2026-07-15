import Link from "next/link";
import { DocsTitle } from "~~/components/docs/DocsTitle";

export default function SdkPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="SDK">RateLoop</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Add a paid human-assurance panel to an AI workflow through one versioned, idempotent API.
      </p>

      <h2>Quote → ask → payment → wait → result</h2>
      <pre>
        <code>{`import { createTokenlessRateLoopClient } from "@rateloop/sdk";

const client = createTokenlessRateLoopClient({ apiBaseUrl, apiKey });
const quote = await client.quote(input);
const ask = await client.ask({ quoteId: quote.quoteId, idempotencyKey, payment });
const instructions = await client.paymentInstructions({ operationKey: ask.operationKey });

// Prepaid: submitPayment({ operationKey: ask.operationKey });
// x402: build and validate the EIP-3009 authorization locally.
await client.submitPayment({ operationKey: ask.operationKey, authorization });

const state = await client.wait({ operationKey: ask.operationKey });
const result = state.status === "ready"
  ? await client.result({ operationKey: ask.operationKey })
  : null;`}</code>
      </pre>

      <h2>Integration rules</h2>
      <ul>
        <li>Reuse the same idempotency key only for the same ask payload.</li>
        <li>Keep private keys outside the SDK; payment instructions expose the facts a separate signer needs.</li>
        <li>Follow the wait cursor and canonical poll URL instead of creating another ask.</li>
        <li>
          Consume results using schema <code>rateloop.tokenless.v2</code>.
        </li>
      </ul>

      <h2>Authorization</h2>
      <p>
        Server integrations use scoped, revocable workspace API keys. RateLoop derives the workspace and authorized
        client/project assignment from the credential; a caller-supplied tenant ID or wallet address grants nothing.
        Browser clients use the HttpOnly RateLoop session, and wallets remain optional until a funding, payout, or
        recovery action needs one.
      </p>
      <p>
        Read <Link href="/docs/ai">Agents &amp; MCP</Link> for publishing lanes, or{` `}
        <Link href="/docs/tech-stack#x402-usdc">x402 + USDC</Link> for the agent-funded payment path.
      </p>
    </article>
  );
}
