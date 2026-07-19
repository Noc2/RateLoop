import Link from "next/link";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const CONTRACTS = [
  {
    id: "tokenless-panel",
    name: "TokenlessPanel",
    role: "Immutable fund core",
    description:
      "Holds customer USDC and enforces funding, voucher-bound commits, deterministic settlement, compensation, refunds, and claims. It has no operator or administrator path to customer funds.",
    color: "var(--rateloop-blue)",
  },
  {
    id: "credential-issuer",
    name: "CredentialIssuer",
    role: "Admission epochs",
    description:
      "Accepts epoch-scoped signers for new admission vouchers. A compromised signer can fill remaining seats in open rounds, influence their verdicts, and direct the bounties for attacker-controlled reports until rotation. It holds no funds and cannot alter an accepted commit or redirect another report's claim.",
    color: "var(--rateloop-green)",
  },
  {
    id: "x402-panel-submitter",
    name: "X402PanelSubmitter",
    role: "Agent-funded adapter",
    description:
      "Consumes the agent's EIP-3009 USDC authorization and funds the selected panel with terms that bind the complete economics and destination.",
    color: "var(--rateloop-pink)",
  },
] as const;

export default function TokenlessContractsPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Contracts">Smart</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Three contracts keep fund custody small, admission separate, and agent-funded USDC settlement explicit.
      </p>

      <div className="not-prose my-8 grid gap-5">
        {CONTRACTS.map(contract => (
          <section
            key={contract.id}
            id={contract.id}
            className="rateloop-surface-card scroll-mt-24 rounded-2xl border-l-2 p-5 sm:p-6"
            style={{ borderLeftColor: contract.color }}
          >
            <p
              className="font-mono text-xs font-semibold uppercase tracking-[0.16em]"
              style={{ color: contract.color }}
            >
              {contract.role}
            </p>
            <h2 className="mt-2 text-xl font-bold text-base-content">
              <code>{contract.name}</code>
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-base-content/65">{contract.description}</p>
          </section>
        ))}
      </div>

      <h2 id="usdc-token-authority">USDC token authority</h2>
      <p>
        Circle retains token-layer authority over USDC and can pause or blacklist transfers, including transfers to or
        from an escrow contract. The fund core&apos;s lack of a RateLoop administrator does not override those token
        controls.
      </p>

      <h2 id="deployment-key">One deployment key</h2>
      <p>
        A release pins the panel, issuer, funding adapter, chain, deployment block, and generated interfaces as one
        complete key. Services reject mixed address bundles instead of guessing which deployment is authoritative.
      </p>

      <h2 id="settlement-evidence">What settlement evidence proves</h2>
      <p>
        Chain evidence can bind a review case to a deployment key, round, transaction receipt, indexed terminal event,
        and deterministic fund accounting. It proves only those recorded chain facts; it does not prove the quality of
        the source material, reviewer competence, or the customer&apos;s final decision. See the full{" "}
        <Link href="/docs/evidence">Evidence &amp; Compliance Mapping</Link>.
      </p>
      <p>
        Return to <Link href="/docs/tech-stack#immutable-fund-core">Immutable Fund Core</Link> for the settlement model,
        or follow the full <Link href="/docs/how-it-works#settlement-paths">settlement paths</Link>.
      </p>
    </article>
  );
}
