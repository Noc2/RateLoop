import { getTranslations } from "next-intl/server";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";

export function AgentsLoadingStatus({ loadingLabel }: { loadingLabel: string }) {
  return (
    <AsyncSection loading loadingLabel={loadingLabel}>
      {null}
    </AsyncSection>
  );
}

export function AgentsLoadingContent({ loadingLabel }: { loadingLabel: string }) {
  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <AgentsLoadingStatus loadingLabel={loadingLabel} />
    </AppPageShell>
  );
}

export default async function AgentsLoading() {
  const t = await getTranslations("agents");
  return <AgentsLoadingContent loadingLabel={t("loadingWorkspace")} />;
}
