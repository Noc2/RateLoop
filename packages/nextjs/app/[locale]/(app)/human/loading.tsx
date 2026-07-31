import { getTranslations } from "next-intl/server";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";

export default async function HumanLoading() {
  const t = await getTranslations("review.queue");
  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <AsyncSection loading loadingLabel={t("loading")}>
        {null}
      </AsyncSection>
    </AppPageShell>
  );
}
