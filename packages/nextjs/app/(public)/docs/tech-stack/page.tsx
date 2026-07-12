export default function TokenlessTechStackPage() {
  return (
    <article className="prose max-w-none">
      <h1>Tech stack</h1>
      <ul>
        <li>Base Sepolia for the isolated test deployment; Base for the eventual hardened deployment.</li>
        <li>USDC-denominated bounty, fee, and attempt reserve.</li>
        <li>Voucher-bound one-time vote keys and relayed commits.</li>
        <li>drand/tlock sealing with a self-reveal fallback.</li>
        <li>Postgres-backed agent quote and ask state.</li>
        <li>Versioned quote → ask → wait → result API and SDK.</li>
      </ul>
    </article>
  );
}
