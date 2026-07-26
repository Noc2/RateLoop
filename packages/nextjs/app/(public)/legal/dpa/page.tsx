import Link from "next/link";

export default function DataProcessingAddendumPage() {
  return (
    <article className="prose legal-prose mx-auto max-w-4xl px-4 py-12">
      <Link href="/legal">&larr; Legal</Link>
      <h1>RateLoop Data Processing Addendum</h1>
      <p>Version: July 2026</p>
      <p>
        This Data Processing Addendum (&quot;DPA&quot;) forms part of the agreement between the business customer
        (&quot;Customer&quot;) and Hawig Ventures UG (haftungsbeschränkt), Herzogin-Juliana-Straße 7, 55469 Simmern,
        Germany (&quot;RateLoop&quot;) when RateLoop processes Customer Personal Data on Customer&apos;s behalf. It is
        intended to satisfy Article 28 GDPR. If a signed order form contains different data-protection terms, that
        signed document controls.
      </p>

      <h2>1. Roles and scope</h2>
      <p>
        Customer is the controller and RateLoop is the processor for Customer Personal Data submitted to a private
        workspace, project, evaluation, reviewer group, or customer-directed integration and processed solely to provide
        the service on Customer&apos;s instructions. Each party remains responsible for determining its actual role.
        RateLoop acts as an independent controller for account security, billing, fraud prevention, legal compliance,
        paid-reviewer eligibility, payout and settlement administration, and data RateLoop publishes to a public chain
        after a separately disclosed action.
      </p>

      <h2>2. Processing details</h2>
      <ul>
        <li>
          <strong>Subject matter and purpose:</strong> hosting and securing private evaluation material; administering
          workspace and reviewer access; obtaining blinded human responses; producing customer-requested evidence and
          exports; and providing support, deletion, resilience, and incident handling.
        </li>
        <li>
          <strong>Duration:</strong> for the service term and afterward only for Customer&apos;s configured retention
          period, deletion reconciliation, backups, active legal holds, or a documented legal duty.
        </li>
        <li>
          <strong>Data subjects:</strong> Customer personnel, agents and contractors; Customer-invited reviewers; and
          individuals whose data Customer lawfully includes in submitted material.
        </li>
        <li>
          <strong>Data types:</strong> account and work contact identifiers, workspace roles, submitted text and media,
          rubrics and instructions, reviewer responses and rationales, assignment and access records, audit/security
          metadata, and support or deletion instructions.
        </li>
        <li>
          <strong>Sensitive data:</strong> the service is not intended for secrets, credentials, regulated special
          category data, criminal-offence data, or children&apos;s data unless the parties first agree written
          instructions and safeguards appropriate to that use.
        </li>
      </ul>

      <h2>3. Documented instructions</h2>
      <p>
        RateLoop will process Customer Personal Data only on Customer&apos;s documented instructions, including the
        agreement, configured workspace controls, authorized API calls, support requests, and lawful deletion or export
        requests. RateLoop will inform Customer before processing required by Union or Member State law unless the law
        prohibits notice. RateLoop will promptly tell Customer if, in its opinion, an instruction infringes applicable
        data-protection law and may pause that instruction while the parties resolve it.
      </p>

      <h2>4. Confidentiality and security</h2>
      <p>
        RateLoop limits access to personnel and contractors who need it to provide or secure the service and who are
        bound by confidentiality. RateLoop maintains measures appropriate to risk, including tenant- and project-scoped
        authorization, short-lived reviewer leases, blinded assignments, encryption in transit, purpose-separated
        authenticated encryption for designated private fields and objects, server-only key material, hashed session
        credentials, access and integrity logging, dependency and source controls, tested backup/deletion procedures,
        and incident response. These measures do not turn a public-chain record into private storage. RateLoop may
        update measures without materially reducing overall protection.
      </p>

      <h2>5. Subprocessors</h2>
      <p>
        Customer gives general written authorization for the subprocessors on the{" "}
        <Link href="/legal/subprocessors">RateLoop subprocessor list</Link>. RateLoop will impose data-protection
        obligations that are no less protective for the relevant processing and remains responsible for its
        subprocessors&apos; performance as required by Article 28(4) GDPR. RateLoop will give at least 30 days&apos;
        advance notice of an intended addition or replacement. Customer may object within 14 days on reasonable
        data-protection grounds. The parties will work in good faith on a reasonable alternative; if none is available,
        either party may terminate the affected service without requiring Customer to accept the new subprocessor.
      </p>

      <h2>6. Assistance and data-subject requests</h2>
      <p>
        Taking account of the nature of processing, RateLoop will reasonably assist Customer with appropriate technical
        and organizational measures for access, correction, deletion, restriction, portability, and objection requests.
        If RateLoop receives a request concerning Customer Personal Data, it will direct the requester to Customer
        unless law permits or requires RateLoop to respond. Customer is responsible for deciding the request and
        providing lawful instructions. RateLoop will also reasonably assist with security obligations, breach
        notifications, data-protection impact assessments, and prior consultation under Articles 32–36 GDPR.
      </p>

      <h2>7. Personal data breaches</h2>
      <p>
        RateLoop will notify Customer without undue delay after confirming a personal data breach affecting Customer
        Personal Data and will provide available information about the nature of the breach, affected categories and
        approximate scale, likely consequences, mitigation, and a contact point. Notice is not an admission of fault.
        Customer remains responsible for notifications for which it is controller.
      </p>

      <h2>8. Return, deletion, and retention</h2>
      <p>
        At Customer&apos;s choice and subject to product capabilities, RateLoop will return an available export and
        delete or anonymize Customer Personal Data after service termination. Deletion may remain in progress while
        private objects, processor copies, and backups are reconciled. RateLoop may retain records that Union or Member
        State law requires, data under a valid legal hold, settlement-safe evidence needed to protect earned reviewer
        pay, and public-chain data it cannot erase; access to retained off-chain data is restricted to the retention
        purpose. Workspace funds are not silently forfeited: a funded workspace remains blocked until a human-confirmed
        refund or other documented lawful resolution, after which the same deletion request resumes.
      </p>

      <h2>9. Information and audits</h2>
      <p>
        RateLoop will make available information reasonably necessary to demonstrate compliance with this DPA and allow
        an audit by Customer or an independent auditor bound by confidentiality. Audits must normally use current
        reports, questionnaires, and remote evidence first; on-site access requires reasonable advance notice, must not
        expose other customers or weaken security, and is limited to once per year unless a confirmed breach or
        supervisory authority requires more. Each party bears its own costs, except that Customer covers unusual
        assistance beyond RateLoop&apos;s standard evidence package.
      </p>

      <h2>10. International transfers</h2>
      <p>
        RateLoop will not transfer Customer Personal Data outside the EEA except on documented instructions and with a
        lawful transfer mechanism. Where no adequacy decision applies, the parties incorporate the applicable European
        Commission standard contractual clauses and relevant supplementary measures. A public-chain action can replicate
        disclosed metadata globally and is not an instruction to publish undisclosed private Customer Personal Data.
      </p>

      <h2>11. Customer responsibilities and precedence</h2>
      <p>
        Customer must have a lawful basis and provide required notices, configure suitable retention and reviewer
        access, minimize submitted data, and avoid prohibited material. Customer will not instruct RateLoop to collect
        raw identity documents where a narrower predicate is sufficient. If this DPA conflicts with the service terms on
        protection of Customer Personal Data, this DPA controls; the applicable signed order otherwise controls
        commercial terms.
      </p>

      <h2>12. Contact</h2>
      <p>
        Data-protection instructions, security notices, audit requests, and subprocessor objections must be sent to
        hawigxyz@proton.me and identify the Customer workspace and an authorized contact.
      </p>
    </article>
  );
}
