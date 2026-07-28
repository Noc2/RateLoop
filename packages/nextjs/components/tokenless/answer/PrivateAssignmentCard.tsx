import { Card } from "~~/components/tokenless/ui/Card";

export type PrivateAnswerAssignment = {
  assignmentId: string;
  projectName: string | null;
  dataClassification: string | null;
  source: string | null;
  status: string | null;
  paidAssignment: boolean;
  confidentialityTermsHash: string | null;
  reservationExpiresAt?: string | null;
  assignmentExpiresAt: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  caseCount: number;
  reviewQuestion?: string | null;
};

function displayStatus(assignment: PrivateAnswerAssignment) {
  if (assignment.status === "completed") return "Completed";
  if (
    assignment.status === "expired" ||
    (assignment.assignmentExpiresAt && Date.parse(assignment.assignmentExpiresAt) <= Date.now())
  ) {
    return "Expired";
  }
  return assignment.status === "accepted" ? "Accepted" : "Closed";
}

function historyNote(status: ReturnType<typeof displayStatus>) {
  if (status === "Completed") {
    return "Your response was submitted. Private source material is unavailable after the review closes.";
  }
  if (status === "Expired") {
    return "No response was submitted before the deadline. Private source material is unavailable after the review closes.";
  }
  return "This assignment closed without a submitted response. Private source material is unavailable after the review closes.";
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

export function PrivateAssignmentCard({ assignment }: { assignment: PrivateAnswerAssignment }) {
  const status = displayStatus(assignment);
  return (
    <li>
      <Card as="details" className="group rounded-lg">
        <summary className="cursor-pointer list-none p-4 marker:hidden sm:p-5 [&::-webkit-details-marker]:hidden">
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
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-base-content/70 group-open:hidden">View details</span>
              <span className="hidden text-sm font-medium text-base-content/70 group-open:inline">Hide details</span>
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
          </div>
        </summary>
        <div className="border-t border-white/[0.07] px-4 py-4 sm:px-5">
          {assignment.reviewQuestion ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-base-content/45">Review focus</p>
              <p className="mt-1 text-sm text-base-content/85">{assignment.reviewQuestion}</p>
            </div>
          ) : null}
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-base-content/45">Assigned</dt>
              <dd className="mt-0.5 text-base-content/80">{dateLabel(assignment.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Last updated</dt>
              <dd className="mt-0.5 text-base-content/80">{dateLabel(assignment.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Cases</dt>
              <dd className="mt-0.5 text-base-content/80">{assignment.caseCount}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Compensation</dt>
              <dd className="mt-0.5 text-base-content/80">{assignment.paidAssignment ? "Paid" : "Unpaid"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-base-content/55">{historyNote(status)}</p>
        </div>
      </Card>
    </li>
  );
}
