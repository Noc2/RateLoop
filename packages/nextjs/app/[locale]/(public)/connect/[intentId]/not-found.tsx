import { getTranslations } from "next-intl/server";
import { Card } from "~~/components/tokenless/ui/Card";
import { Link } from "~~/i18n/navigation";

export default async function AgentConnectionNotFound() {
  const t = await getTranslations("agents.connectNotFound");

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:py-16">
      <Card as="section" className="rounded-2xl p-6 sm:p-8" aria-labelledby="connection-unavailable-heading">
        <p className="font-mono text-xs uppercase tracking-widest text-error">{t("eyebrow")}</p>
        <h1 id="connection-unavailable-heading" className="mt-3 text-3xl font-semibold">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-base-content/70">{t("description")}</p>
        <Link href="/agents/connections" className="btn btn-primary mt-6">
          {t("action")}
        </Link>
      </Card>
    </div>
  );
}
