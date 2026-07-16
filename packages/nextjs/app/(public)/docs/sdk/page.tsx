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

      <h2 id="evidence-exports">Evidence exports</h2>
      <p>
        Workspace members with the required role can export a completed run packet, adaptive-coverage history, the
        workspace audit chain, and the workspace&apos;s trusted-key history.
      </p>
      <pre>
        <code>{`GET /api/account/workspaces/{workspaceId}/assurance/runs/{runId}/evidence
GET /api/account/workspaces/{workspaceId}/assurance/coverage/export
GET /api/account/workspaces/{workspaceId}/audit/export
GET /api/account/workspaces/{workspaceId}/assurance/trusted-keys
GET /api/account/workspaces/{workspaceId}/assurance/trusted-keys?format=spki&keyId=ed25519:…`}</code>
      </pre>
      <p>
        Download the matching SPKI pin from the authenticated workspace key history, then run the local checkers with an
        explicit key ID instead of trusting keys or heads from the same export:
      </p>
      <pre>
        <code>{`yarn workspace @rateloop/nextjs evidence:verify ./packet.json --public-key ./key.txt --key-id ed25519:…
yarn workspace @rateloop/nextjs audit:verify ./audit-export.json --expected-head sha256:…
yarn workspace @rateloop/nextjs attestation:verify ./attestation-witness.json \\
  --signer-public-key ./trusted-attestation-signer.pem --signer-key-id ed25519:… \\
  --rekor-public-key ./trusted-rekor-public-key.pem \\
  --tsa-ca ./trusted-tsa-ca.pem --tsa-chain ./trusted-tsa-chain.pem`}</code>
      </pre>
      <p>
        Read <Link href="/docs/evidence">Evidence &amp; Compliance Mapping</Link> for verification boundaries,{` `}
        <Link href="/docs/ai">Agents &amp; MCP</Link> for publishing lanes, or{` `}
        <Link href="/docs/tech-stack#x402-usdc">x402 + USDC</Link> for the agent-funded payment path.
      </p>
    </article>
  );
}
