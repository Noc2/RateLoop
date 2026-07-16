"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { SignInSurface } from "~~/components/auth/SignInSurface";

const ThirdwebSessionButton = dynamic(
  () => import("~~/components/thirdweb/ThirdwebSessionButton").then(module => module.ThirdwebSessionButton),
  { ssr: false },
);

export function HumanAccountSignInPrompt({ tab }: { tab: "profile" | "settings" }) {
  const router = useRouter();
  const title = tab === "profile" ? "Your profile" : "Your settings";

  return (
    <SignInSurface
      description={`Sign in to view and update your ${tab}.`}
      title={title}
      titleId="human-account-sign-in-title"
    >
      <div className="inline-flex">
        <ThirdwebSessionButton
          compact
          onSessionChange={authenticated => {
            if (authenticated) router.refresh();
          }}
        />
      </div>
    </SignInSurface>
  );
}
