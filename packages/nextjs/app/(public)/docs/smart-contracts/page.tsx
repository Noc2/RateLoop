export default function TokenlessContractsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Smart contracts</h1>
      <dl>
        <dt>
          <code>TokenlessPanel</code>
        </dt>
        <dd>
          The only fund-holding core: round funding, voucher-bound commits, settlement, compensation, refunds, and
          claims.
        </dd>
        <dt>
          <code>CredentialIssuer</code>
        </dt>
        <dd>Epoch-based signer acceptance for future admission. It holds no funds.</dd>
        <dt>
          <code>X402PanelSubmitter</code>
        </dt>
        <dd>Optional stateless funding adapter whose signed terms bind every economic field and panel address.</dd>
      </dl>
      <p>
        The test contracts are disposable until Phase 5 hardening. No legacy address or storage-layout continuity is
        promised.
      </p>
    </article>
  );
}
