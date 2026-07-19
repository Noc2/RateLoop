import { SignedOutGate } from "~~/components/auth/SignedOutGate";

export function HumanAccountSignInPrompt({ tab }: { tab: "profile" | "settings" }) {
  const title = tab === "profile" ? "Your profile" : "Your settings";

  return (
    <SignedOutGate
      description={`Sign in to view and update your ${tab}.`}
      returnTo={`/human?tab=${tab}`}
      title={title}
      titleId="human-account-sign-in-title"
    />
  );
}
