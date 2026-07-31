import { useLocale, useTranslations } from "next-intl";
import { SignedOutGate } from "~~/components/auth/SignedOutGate";

export function HumanAccountSignInPrompt({
  returnTo,
  tab,
}: {
  returnTo: string;
  tab: "inbox" | "profile" | "settings";
}) {
  const locale = useLocale();
  const t = useTranslations("human.signIn");
  const title = tab === "inbox" ? t("inboxTitle") : tab === "profile" ? t("profileTitle") : t("settingsTitle");
  const description =
    tab === "inbox" ? t("inboxDescription") : t("accountDescription", { section: title.toLocaleLowerCase(locale) });

  return (
    <SignedOutGate description={description} returnTo={returnTo} title={title} titleId="human-account-sign-in-title" />
  );
}
