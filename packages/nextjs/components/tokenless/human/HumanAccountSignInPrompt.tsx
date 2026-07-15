"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

const ThirdwebSessionButton = dynamic(
  () => import("~~/components/thirdweb/ThirdwebSessionButton").then(module => module.ThirdwebSessionButton),
  { ssr: false },
);

export function HumanAccountSignInPrompt({ tab }: { tab: "profile" | "settings" }) {
  const router = useRouter();
  const title = tab === "profile" ? "Your profile" : "Your settings";

  return (
    <section className="surface-card rounded-2xl p-8 text-center" aria-labelledby="human-account-sign-in-title">
      <h1 id="human-account-sign-in-title" className="font-display text-2xl font-semibold text-base-content">
        {title}
      </h1>
      <p className="mx-auto mb-6 mt-3 max-w-md text-base leading-6 text-base-content/70">
        Sign in to view and update your {tab}.
      </p>
      <div className="inline-flex">
        <ThirdwebSessionButton
          compact
          onSessionChange={authenticated => {
            if (authenticated) router.refresh();
          }}
        />
      </div>
    </section>
  );
}
