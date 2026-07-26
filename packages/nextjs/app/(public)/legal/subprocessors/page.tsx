import Link from "next/link";

const coreProviders = [
  {
    provider: "Vercel, Inc.",
    purpose: "Web application hosting, edge delivery, server functions, and operational request logs.",
    condition: "Core hosted application.",
  },
  {
    provider: "Railway Corp.",
    purpose: "Isolated runtime services and managed PostgreSQL used by the tokenless service, indexer, and keeper.",
    condition: "Core hosted data and worker runtime.",
  },
] as const;

const conditionalProviders = [
  {
    provider: "Resend, Inc.",
    purpose: "Email one-time codes, subscription verification, and user-requested operational notifications.",
    condition: "Only when outbound email is configured or requested.",
  },
  {
    provider: "Stripe Payments Europe, Limited and Stripe affiliates",
    purpose: "Business subscription billing, invoices, tax/VAT fields, fraud controls, and payment status.",
    condition: "Only when a customer uses Stripe billing or invoice funding.",
  },
  {
    provider: "Amazon Web Services EMEA SARL and AWS affiliates",
    purpose: "Managed key operations, private object storage, locked evidence exports, or attestation services.",
    condition: "Only for a provisioned managed AWS feature; source-code support alone does not enable processing.",
  },
  {
    provider: "thirdweb, Inc. and its service providers",
    purpose: "Optional app-scoped wallet creation, recovery, and wallet infrastructure.",
    condition: "Only after a signed-in user explicitly chooses the optional managed-wallet feature.",
  },
  {
    provider: "Google LLC / Google Ireland Limited or Apple distribution affiliates",
    purpose: "Optional federated account sign-in.",
    condition: "Only when the provider is configured and the user selects it.",
  },
] as const;

function ProviderTable({
  providers,
}: {
  providers: readonly { provider: string; purpose: string; condition: string }[];
}) {
  return (
    <div className="not-prose overflow-x-auto">
      <table className="table w-full">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Processing purpose</th>
            <th>When used</th>
          </tr>
        </thead>
        <tbody>
          {providers.map(provider => (
            <tr key={provider.provider}>
              <td>{provider.provider}</td>
              <td>{provider.purpose}</td>
              <td>{provider.condition}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SubprocessorsPage() {
  return (
    <article className="prose legal-prose mx-auto max-w-5xl px-4 py-12">
      <Link href="/legal">&larr; Legal</Link>
      <h1>RateLoop subprocessors</h1>
      <p>Last updated: July 2026</p>
      <p>
        This page identifies providers RateLoop is authorized to use when it processes Customer Personal Data under the{" "}
        <Link href="/legal/dpa">Data Processing Addendum</Link>. A conditional provider receives covered data only when
        its corresponding feature is enabled and used. Customers may request a snapshot of providers enabled for their
        workspace and the applicable transfer mechanism.
      </p>

      <h2>Core hosted subprocessors</h2>
      <ProviderTable providers={coreProviders} />

      <h2>Conditional feature subprocessors</h2>
      <ProviderTable providers={conditionalProviders} />

      <h2>Services that may be independent recipients</h2>
      <p>
        A public Base transaction, USDC transfer, or drand/timelock action is distributed through public infrastructure
        and is not a confidential processor copy. World ID or another eligibility provider, a self-custodial wallet
        provider, and the privacy-enhanced YouTube player may act as an independent controller for their own purposes
        under their terms. RateLoop contacts the YouTube player only after the user chooses play. The product discloses
        these boundaries before the relevant optional action.
      </p>

      <h2>Locations and transfers</h2>
      <p>
        RateLoop selects EEA hosting regions where the deployed provider and feature support them. Provider support,
        security, resilience, and limited remote administration may involve another country. For covered transfers
        outside the EEA, RateLoop relies on an applicable adequacy decision or the European Commission&apos;s standard
        contractual clauses with supplementary technical and organizational measures as required. Public-chain
        replication is described separately in the privacy notice and transaction preview.
      </p>

      <h2>Change notices and objections</h2>
      <p>
        RateLoop will give affected business customers at least 30 days&apos; advance notice by email to the workspace
        owner or designated privacy contact before adding or replacing a subprocessor for Customer Personal Data.
        Customer may object within 14 days on reasonable data-protection grounds by emailing hawigxyz@proton.me.
        RateLoop will assess a reasonable alternative; if none is available, either party may terminate the affected
        service without requiring Customer to accept that provider. Emergency replacements needed to preserve security
        or availability will be notified as soon as reasonably possible.
      </p>
    </article>
  );
}
