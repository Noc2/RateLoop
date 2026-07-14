import Link from "next/link";

export type PrivateAnswerAssignment = {
  assignmentId: string;
  projectName: string | null;
  dataClassification: string | null;
  source: string | null;
  status: string | null;
  paidAssignment: boolean;
  confidentialityTermsHash: string | null;
  assignmentExpiresAt: string | null;
  caseCount: number;
};

export function PrivateAssignmentCard({ assignment }: { assignment: PrivateAnswerAssignment }) {
  return (
    <article className="rateloop-surface-card p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Private assignment</p>
          <h2 className="mt-2 text-2xl font-semibold">{assignment.projectName ?? "Assigned private review"}</h2>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-base-content/60">
          {assignment.status ?? "reserved"}
        </span>
      </div>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-base-content/45">Data handling</dt>
          <dd className="mt-1">{assignment.dataClassification ?? "Private"}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Cases</dt>
          <dd className="mt-1">{assignment.caseCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Reviewer source</dt>
          <dd className="mt-1">{assignment.source?.replaceAll("_", " ") ?? "Assigned"}</dd>
        </div>
      </dl>
      <p className="mt-5 text-sm leading-6 text-base-content/60">
        Artifacts remain hidden until you accept the exact confidentiality terms. Access is account-bound and leased for
        a short period.
      </p>
      {assignment.assignmentExpiresAt ? (
        <p className="mt-3 text-xs text-base-content/45">
          Assignment expires {new Date(assignment.assignmentExpiresAt).toLocaleString()}
        </p>
      ) : null}
      <Link
        href={`/rate?assignment=${encodeURIComponent(assignment.assignmentId)}&terms=${encodeURIComponent(assignment.confidentialityTermsHash ?? "")}`}
        className="rateloop-gradient-action mt-5 inline-flex px-5"
      >
        Open private review
      </Link>
    </article>
  );
}
