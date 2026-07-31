import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";

export default function AgentsLoading() {
  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <AsyncSection loading loadingLabel="Loading workspace">
        {null}
      </AsyncSection>
    </AppPageShell>
  );
}
