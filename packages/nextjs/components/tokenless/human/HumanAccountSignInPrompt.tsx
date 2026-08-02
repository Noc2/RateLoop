import { useTranslations } from "next-intl";
import { SignedOutGate } from "~~/components/auth/SignedOutGate";

export function HumanAccountSignInPrompt({
  returnTo,
  tab,
}: {
  returnTo: string;
  tab: "inbox" | "profile" | "settings";
}) {
  const t = useTranslations("human.signIn");
  const title = tab === "inbox" ? t("inboxTitle") : tab === "profile" ? t("profileTitle") : t("settingsTitle");

  return <SignedOutGate returnTo={returnTo} title={title} titleId="human-account-sign-in-title" />;
}
