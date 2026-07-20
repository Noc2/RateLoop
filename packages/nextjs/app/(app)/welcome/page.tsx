import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { completeWelcomeAction } from "./actions";
import type { Metadata } from "next";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { Button } from "~~/components/tokenless/ui/Button";
import { getPrincipalWelcomeState } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";

export const metadata: Metadata = {
  title: "Welcome",
  description: "Choose where to start in RateLoop.",
};

function ChoiceForm({
  choice,
  children,
  secondary = false,
}: {
  choice: string;
  children: string;
  secondary?: boolean;
}) {
  return (
    <form action={completeWelcomeAction}>
      <input type="hidden" name="choice" value={choice} />
      <Button className="min-h-11 w-full" type="submit" variant={secondary ? "secondary" : "primary"}>
        {children}
      </Button>
    </form>
  );
}

export default async function WelcomePage() {
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) redirect("/sign-in?returnTo=%2Fwelcome");

  const welcome = await getPrincipalWelcomeState(session.principalId);
  if (!welcome.required) redirect("/");

  return (
    <AppPageShell outerClassName="pb-12" contentClassName="mx-auto max-w-5xl">
      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--rateloop-blue)]">Welcome</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">What would you like to do first?</h1>
      </header>

      <div className="mt-9 grid gap-5 md:grid-cols-2">
        <section className="surface-card flex flex-col rounded-2xl border-l-2 border-l-[var(--rateloop-green)] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold">Review AI work</h2>
          <p className="mt-3 text-base leading-7 text-base-content/65">
            Find available reviews or use an invitation from a workspace.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 md:mt-auto md:pt-8">
            <ChoiceForm choice="review">Start reviewing</ChoiceForm>
            <ChoiceForm choice="invitation" secondary>
              I have an invitation
            </ChoiceForm>
          </div>
        </section>

        <section className="surface-card flex flex-col rounded-2xl border-l-2 border-l-[var(--rateloop-blue)] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold">Connect an agent</h2>
          <p className="mt-3 text-base leading-7 text-base-content/65">
            Create a workspace and choose when your agent asks for human review.
          </p>
          <div className="mt-8 md:mt-auto md:pt-8">
            <ChoiceForm choice="agent">Set up an agent</ChoiceForm>
          </div>
        </section>
      </div>
    </AppPageShell>
  );
}
