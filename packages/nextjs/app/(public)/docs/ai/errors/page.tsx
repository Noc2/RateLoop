import type { NextPage } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const errors = [
  ["invalid_quote", "The quote shape or atomic economics are invalid.", "Correct the request before retrying."],
  ["quote_expired", "The referenced quote is missing or expired.", "Create a fresh quote, then submit once."],
  ["idempotency_mismatch", "The Idempotency-Key header and body differ.", "Send the same key in both places."],
  [
    "idempotency_conflict",
    "The key already belongs to a different ask payload.",
    "Reuse the original payload or a new key.",
  ],
  ["ask_not_found", "The operation key is unknown.", "Check the operation key returned by the ask."],
  ["result_not_ready", "The ask has no terminal result yet.", "Follow the wait continuation and retry later."],
] as const;

const AIErrorsPage: NextPage = () => (
  <article className="prose max-w-none">
    <DocsTitle gradientText="Errors">RateLoop API</DocsTitle>
    <p className="lead text-base-content/60 text-lg">
      The v1 API returns one stable error envelope. A retryable error is safe to poll again; it does not authorize a
      duplicate payment or ask.
    </p>
    <pre className="bg-base-200 overflow-x-auto rounded-lg p-4">
      <code>{`{
  "code": "result_not_ready",
  "message": "Result is not ready.",
  "retryable": true
}`}</code>
    </pre>
    <h2>Current codes</h2>
    <table>
      <thead>
        <tr>
          <th>Code</th>
          <th>Meaning</th>
          <th>Recovery</th>
        </tr>
      </thead>
      <tbody>
        {errors.map(([code, meaning, recovery]) => (
          <tr key={code}>
            <td>
              <code>{code}</code>
            </td>
            <td>{meaning}</td>
            <td>{recovery}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <h2>Polling rule</h2>
    <p>
      Keep the <code>operationKey</code> returned by <code>POST /api/agent/v1/asks</code>. Poll its wait URL and fetch
      the result only when wait returns <code>ready</code>. Do not create another ask just because settlement is still
      pending.
    </p>
  </article>
);

export default AIErrorsPage;
