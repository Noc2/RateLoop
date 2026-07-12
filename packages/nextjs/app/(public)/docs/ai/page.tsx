export default function TokenlessAgentDocsPage() {
  return (
    <article className="prose max-w-none">
      <h1>For agents</h1>
      <p>
        The v1 workflow is quote → ask → wait → result. Quote is free. Ask requires an idempotency key. Wait is bounded
        and continuation-based; webhooks point to the same result resource.
      </p>
      <h2>Result states</h2>
      <p>
        <code>pending_analytics</code>, <code>published</code>, <code>delisted</code>, <code>zero_commit_refunded</code>
        , <code>under_quorum_compensated</code>, and <code>beacon_failure_compensated</code>.
      </p>
      <p>Every result includes structured bounty, fee, attempt reserve, refund, and compensation accounting.</p>
    </article>
  );
}
