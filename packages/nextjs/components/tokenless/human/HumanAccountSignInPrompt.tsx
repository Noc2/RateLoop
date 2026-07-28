import { SignedOutGate } from "~~/components/auth/SignedOutGate";

export function HumanAccountSignInPrompt({
  returnTo,
  tab,
}: {
  returnTo: string;
  tab: "inbox" | "profile" | "settings";
}) {
  const title = tab === "inbox" ? "Your inbox" : tab === "profile" ? "Your profile" : "Your settings";
  const description =
    tab === "inbox" ? "Sign in to view your reviewer notifications." : `Sign in to view and update your ${tab}.`;

  return (
    <SignedOutGate description={description} returnTo={returnTo} title={title} titleId="human-account-sign-in-title" />
  );
}
