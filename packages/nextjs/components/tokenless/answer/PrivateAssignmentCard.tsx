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
    <article className="surface-card rounded-lg p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Private assignment</p>
          <h2 className="mt-2 text-2xl font-semibold">{assignment.projectName ?? "Assigned private review"}</h2>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-base-content/60">
          {assignment.status ?? "reserved"}
        </span>
      </div>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-base-content/45">Data handling</dt>
          <dd className="mt-1">{assignment.dataClassification ?? "Private"}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Cases</dt>
          <dd className="mt-1">{assignment.caseCount}</dd>
        </div>
      </dl>
      {assignment.assignmentExpiresAt ? (
        <p className="mt-3 text-xs text-base-content/45">
          Assignment expires {new Date(assignment.assignmentExpiresAt).toLocaleString()}
        </p>
      ) : null}
    </article>
  );
}
