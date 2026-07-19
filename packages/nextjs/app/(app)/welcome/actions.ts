"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { completePrincipalWelcome } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { parseWelcomeChoice, welcomeDestination } from "~~/lib/auth/welcome";

export async function completeWelcomeAction(formData: FormData) {
  const choice = parseWelcomeChoice(formData.get("choice"));
  if (!choice) throw new Error("Choose how you want to start.");

  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) redirect("/sign-in?returnTo=%2Fwelcome");

  await completePrincipalWelcome(session.principalId);
  redirect(welcomeDestination(choice));
}
