import { useTranslations } from "next-intl";
import { SignedOutGate } from "~~/components/auth/SignedOutGate";

/**
 * The signed-out state for every human surface.
 *
 * All five use the same centered, tab-less card: navigation a visitor cannot use
 * is noise, and rendering it meant one surface put its card at the top of the
 * page while the other four centered it. The title carries the purpose because
 * the destination is already named by the active item in the sidebar.
 */
export function HumanAccountSignInPrompt({
  returnTo,
  tab,
}: {
  returnTo: string;
  tab: "discover" | "history" | "inbox" | "profile" | "settings";
}) {
  const t = useTranslations("human.signIn");
  const title = t(
    tab === "discover"
      ? "reviewTitle"
      : tab === "history"
        ? "historyTitle"
        : tab === "inbox"
          ? "inboxTitle"
          : tab === "profile"
            ? "profileTitle"
            : "settingsTitle",
  );

  return <SignedOutGate returnTo={returnTo} title={title} titleId="human-account-sign-in-title" />;
}
