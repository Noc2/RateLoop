import { HumanAssuranceRaterClient } from "~~/components/tokenless/HumanAssuranceRaterClient";
import { AnswerPageClient } from "~~/components/tokenless/answer/AnswerPageClient";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

export default async function RatePage({
  searchParams,
}: {
  searchParams: Promise<{
    assignment?: string | string[];
    terms?: string | string[];
    q?: string | string[];
    scope?: string | string[];
  }>;
}) {
  const { assignment, terms, q, scope } = await searchParams;
  const assignmentId = Array.isArray(assignment) ? assignment[0] : assignment;
  const normalizedScope = Array.isArray(scope) ? scope[0] : scope;
  if (!assignmentId) {
    const initialQuery = Array.isArray(q) ? q[0] : q;
    const initialScope = ["all", "public", "private", "submitted"].includes(normalizedScope ?? "")
      ? (normalizedScope as "all" | "public" | "private" | "submitted")
      : "all";
    return (
      <AnswerPageClient
        initialQuery={initialQuery}
        initialScope={initialScope}
        sandboxMode={isTokenlessSandboxMode()}
      />
    );
  }
  return (
    <HumanAssuranceRaterClient
      initialAssignmentId={assignment}
      initialTermsHash={terms}
      sandboxMode={isTokenlessSandboxMode()}
    />
  );
}
