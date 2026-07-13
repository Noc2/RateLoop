import { HumanAssuranceRaterClient } from "~~/components/tokenless/HumanAssuranceRaterClient";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

export default async function RatePage({
  searchParams,
}: {
  searchParams: Promise<{ assignment?: string | string[]; terms?: string | string[] }>;
}) {
  const { assignment, terms } = await searchParams;
  return (
    <HumanAssuranceRaterClient
      initialAssignmentId={assignment}
      initialTermsHash={terms}
      sandboxMode={isTokenlessSandboxMode()}
    />
  );
}
