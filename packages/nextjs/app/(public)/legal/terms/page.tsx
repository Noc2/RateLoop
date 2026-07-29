import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <article className="prose legal-prose mx-auto max-w-4xl px-4 py-12">
      <Link href="/legal">&larr; Legal</Link>
      <h1>RateLoop terms</h1>
      <p>Last updated: July 2026</p>
      <nav
        aria-label="On this page"
        className="not-prose my-8 rounded-2xl border border-base-content/10 bg-base-content/[0.025] p-5 sm:p-6"
      >
        <h2 className="text-lg font-semibold text-base-content">At a glance</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-base-content/70">
          <li>Users must be at least 18 and legally permitted to use the service.</li>
          <li>Customers remain responsible for submitted material, reviewer choice, and final decisions.</li>
          <li>Workspace subscriptions renew until cancelled under the displayed billing terms.</li>
          <li>Fund-backed review and public-chain terms apply only where those features are offered.</li>
        </ul>
        <p className="mt-4 text-xs leading-5 text-base-content/55">
          This summary helps you navigate. The complete terms below provide the details.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {[
            ["Service scope", "#service-scope"],
            ["Who may use it", "#who-may-use"],
            ["Customer material", "#customer-material"],
            ["AI system suppliers", "#ai-system-supplier"],
            ["Subscriptions", "#workspace-subscriptions"],
            ["Trust and privacy", "#trust-privacy"],
            ["Use of results", "#use-of-results"],
          ].map(([label, href]) => (
            <li key={href}>
              <a
                href={href}
                className="inline-flex rounded-lg border border-base-content/15 bg-base-content/[0.05] px-3 py-2 text-sm font-semibold text-base-content/75 no-underline hover:border-base-content/30 hover:text-base-content"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <h2 id="service-scope">Service scope</h2>
      <p>
        RateLoop provides software for blinded human assurance, workspace coordination, reviewer access, decision
        evidence, and, where offered, itemized participant compensation and public-chain settlement. The interface
        displays the available reviewer source and economic terms before a run is funded.
      </p>
      <h2 id="who-may-use">Who may use it</h2>
      <p>
        You must be at least 18 and legally permitted to use the service. Real-money funder flows and workspace
        subscriptions are available only to approved business customers whose legal identity RateLoop has independently
        verified. Paid assignments require an exact frozen assignment policy and all applicable capability, tax,
        sanctions, payout, voucher, settlement, and receipt checks.
      </p>
      <h2 id="customer-material">Customer material and reviewers</h2>
      <p>
        Customers must have the right to submit evaluation material, minimize and redact personal or confidential data,
        choose appropriate reviewers, and provide any required notices. A one-time invitation proves project access, not
        unique humanity, expertise, legal residence, or paid-work eligibility. Customer-invited and RateLoop-network
        results are labeled separately. Hybrid review is not offered in this release.
      </p>
      <p>
        Where RateLoop processes personal data in private customer material on the customer&apos;s behalf, the{" "}
        <Link href="/legal/dpa">Data Processing Addendum</Link> forms part of the business service agreement. RateLoop
        remains an independent controller for its own account security, billing, legal compliance, paid-reviewer
        eligibility, fraud prevention, and public-chain settlement purposes. The parties&apos; roles follow the actual
        processing activity, not a blanket label.
      </p>
      <h2 id="ai-system-supplier">AI system supplier schedule</h2>
      <p>
        This section applies only where a signed order identifies the customer as the provider of a high-risk AI system
        and identifies RateLoop services that are used or integrated in that system for purposes of Article 25(4) of the
        EU AI Act. It does not apply merely because RateLoop operates alongside a customer&apos;s system.
      </p>
      <p>
        For that identified integration, the applicable order, service documentation, and this schedule form the written
        agreement between the parties. RateLoop will provide the documented service capabilities and limitations,
        relevant technical access and interfaces, reasonably necessary integration information and assistance, and
        information about the expertise supporting those services. The customer remains responsible for specifying what
        it needs to meet its obligations as provider. Both parties must cooperate in good faith within their respective
        technical control; this schedule is not an attestation and does not establish compliance.
      </p>
      <h2 id="funding-accepted-work">Funding and accepted work</h2>
      <p>
        The protocol itemizes bounty, platform fee, and maximum attempt reserve before funding. Once the first paid
        commit is accepted, a funder cannot cancel the round. Accepted work must reach the disclosed paid or compensated
        terminal path even when quorum or infrastructure fails.
      </p>
      <h2 id="workspace-subscriptions">Workspace subscriptions</h2>
      <p>
        RateLoop may offer a recurring business-to-business workspace subscription. The displayed price, billing period,
        included review-decision allowance, and applicable tax are confirmed before checkout. Subscriptions renew
        automatically until cancelled. Cancellation takes effect at the end of the paid period; already-accepted review
        work may finish and historical evidence is not deleted merely because a plan ends.
      </p>
      <p>
        The Early Access price applies for the first 12 months. RateLoop will give at least 60 days&apos; notice before
        a later price change. After the first 12 months, founding customers receive 20% off the then-current comparable
        monthly plan. There is no lifetime price guarantee, and a customer may cancel before a new price takes effect.
      </p>
      <h2>Separate subscription and panel costs</h2>
      <p>
        A workspace subscription pays for access to the RateLoop software and its plan limits. It does not include
        participant bounty, attempt reserve, or the separately disclosed public-panel execution fee. Those panel costs
        are itemized before funding and do not increase a workspace&apos;s subscription allowance.
      </p>
      <h2 id="billing-refunds">Billing, taxes, and refunds</h2>
      <p>
        Subscriptions are intended for approved business customers. Customers must provide accurate legal, invoice,
        trader, tax, and VAT details and remain responsible for taxes not collected at checkout. Stripe processes
        subscription payment details and provides invoices and receipts. Except where law requires otherwise or RateLoop
        agrees in writing, paid subscription periods are non-refundable.
      </p>
      <h2 id="trust-privacy">Trust and privacy limits</h2>
      <p>
        The immutable panel core has no operator withdrawal path. A separate issuer controls new voucher admission. If
        its signer is compromised, an attacker can fill remaining seats in open rounds, influence their verdicts, and
        direct the bounties for those attacker-controlled reports until the signer is rotated. The issuer still cannot
        redirect escrow, redirect another report&apos;s claim, or change an accepted commit.
      </p>
      <p>
        A paid commit publishes a timelock-encrypted vote, prediction, response hash, payout address, and salt. The
        commit irrevocably schedules those details to become publicly decryptable at the configured drand beacon after
        the commit deadline, whether or not the reviewer or keeper later reveals or claims; there is no post-commit
        abort. Reusing a payout destination can link rounds.
      </p>
      <p>
        Circle retains token-layer authority over USDC and can pause or blacklist transfers, including transfers to or
        from an escrow contract. The panel&apos;s no-operator-withdrawal design does not override those USDC controls.
      </p>
      <h2 id="use-of-results">Use of results</h2>
      <p>
        RateLoop supplies decision evidence, limitations, and settlement records. The customer remains responsible for
        the final go, revise, or stop decision. RateLoop results are not financial, legal, medical, or investment advice
        and must not be used as an automatic approval for regulated or safety-critical decisions.
      </p>
      <p>
        A funded panel result is commissioned business-to-business research. It is not an organic consumer review,
        testimonial, endorsement, or measure of general public opinion. The customer must disclose that commissioned
        status whenever it publishes or shares the result and must not present paid reviewer feedback as unsolicited
        customer or consumer feedback. The applicable{" "}
        <Link href="/docs/evidence#commissioned-paid-panels">paid-panel methodology</Link> forms part of these terms.
      </p>
      <h2>Operator</h2>
      <p>
        The interface is operated by Hawig Ventures UG (haftungsbeschränkt). See the{" "}
        <Link href="/legal/imprint">imprint</Link>
        for contact information.
      </p>
    </article>
  );
}
