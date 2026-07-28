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

function displayStatus(assignment: PrivateAnswerAssignment) {
  if (assignment.status === "completed") return "Completed";
  if (
    assignment.status === "expired" ||
    assignment.status === "released" ||
    (assignment.assignmentExpiresAt && Date.parse(assignment.assignmentExpiresAt) <= Date.now())
  ) {
    return "Expired";
  }
  return assignment.status === "accepted" ? "Accepted" : "Closed";
}

export function PrivateAssignmentCard({ assignment }: { assignment: PrivateAnswerAssignment }) {
  const status = displayStatus(assignment);
  return (
    <li>
      <article className="surface-card rounded-lg p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{assignment.projectName ?? "Private review"}</h2>
            <p className="mt-1 text-sm text-base-content/55">
              {assignment.caseCount} {assignment.caseCount === 1 ? "case" : "cases"}
              {status === "Expired" && assignment.assignmentExpiresAt ? (
                <>
                  {" · "}
                  Expired{" "}
                  <time dateTime={assignment.assignmentExpiresAt}>
                    {new Date(assignment.assignmentExpiresAt).toLocaleString()}
                  </time>
                </>
              ) : null}
              {status === "Accepted" && assignment.assignmentExpiresAt ? (
                <>
                  {" · "}
                  Due{" "}
                  <time dateTime={assignment.assignmentExpiresAt}>
                    {new Date(assignment.assignmentExpiresAt).toLocaleString()}
                  </time>
                </>
              ) : null}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              status === "Completed"
                ? "bg-emerald-400/10 text-emerald-100"
                : status === "Expired"
                  ? "bg-white/[0.06] text-base-content/60"
                  : "bg-amber-400/10 text-amber-100"
            }`}
          >
            {status}
          </span>
        </div>
      </article>
    </li>
  );
}
