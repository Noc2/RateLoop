import { useFormatter, useTranslations } from "next-intl";
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

type AssignmentStatus = "accepted" | "closed" | "completed" | "expired";

function displayStatus(assignment: PrivateAnswerAssignment): AssignmentStatus {
  if (assignment.status === "completed") return "completed";
  if (
    assignment.status === "expired" ||
    (assignment.assignmentExpiresAt && Date.parse(assignment.assignmentExpiresAt) <= Date.now())
  ) {
    return "expired";
  }
  return assignment.status === "accepted" ? "accepted" : "closed";
}

export function PrivateAssignmentCard({ assignment }: { assignment: PrivateAnswerAssignment }) {
  const t = useTranslations("review.privateAssignment");
  const format = useFormatter();
  const status = displayStatus(assignment);
  const dateLabel = (value: string | null | undefined) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" }) : t("notRecorded");
  return (
    <li>
      <Card as="details" className="group rounded-lg">
        <summary className="cursor-pointer list-none p-4 marker:hidden sm:p-5 [&::-webkit-details-marker]:hidden">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{assignment.projectName ?? t("privateReview")}</h2>
              <p className="mt-1 text-sm text-base-content/55">
                {t("cases", { count: assignment.caseCount })}
                {status === "expired" && assignment.assignmentExpiresAt ? (
                  <>
                    {" · "}
                    {t("expiredAt", { date: dateLabel(assignment.assignmentExpiresAt) })}
                  </>
                ) : null}
                {status === "accepted" && assignment.assignmentExpiresAt ? (
                  <>
                    {" · "}
                    {t("dueAt", { date: dateLabel(assignment.assignmentExpiresAt) })}
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-base-content/70 group-open:hidden">{t("viewDetails")}</span>
              <span className="hidden text-sm font-medium text-base-content/70 group-open:inline">
                {t("hideDetails")}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs ${
                  status === "completed"
                    ? "bg-success/10 text-success"
                    : status === "expired"
                      ? "bg-base-content/[0.06] text-base-content/60"
                      : "bg-warning/10 text-warning"
                }`}
              >
                {t(`status.${status}`)}
              </span>
            </div>
          </div>
        </summary>
        <div className="border-t border-base-content/[0.07] px-4 py-4 sm:px-5">
          {assignment.reviewQuestion ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-base-content/55">{t("reviewFocus")}</p>
              <p className="mt-1 text-sm text-base-content/85">{assignment.reviewQuestion}</p>
            </div>
          ) : null}
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-base-content/55">{t("assigned")}</dt>
              <dd className="mt-0.5 text-base-content/80">{dateLabel(assignment.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">{t("updated")}</dt>
              <dd className="mt-0.5 text-base-content/80">{dateLabel(assignment.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">{t("caseCount")}</dt>
              <dd className="mt-0.5 text-base-content/80">{assignment.caseCount}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">{t("compensation")}</dt>
              <dd className="mt-0.5 text-base-content/80">{assignment.paidAssignment ? t("paid") : t("unpaid")}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-base-content/55">
            {status === "completed" ? t("completedNote") : status === "expired" ? t("expiredNote") : t("closedNote")}
          </p>
        </div>
      </Card>
    </li>
  );
}
