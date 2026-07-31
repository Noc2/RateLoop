"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "~~/i18n/config";
import { completePrincipalWelcome } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { parseWelcomeChoice, welcomeDestination } from "~~/lib/auth/welcome";

export async function completeWelcomeAction(formData: FormData) {
  const choice = parseWelcomeChoice(formData.get("choice"));
  if (!choice) throw new Error("Choose how you want to start.");
  const requestedLocale = formData.get("locale");
  const locale = typeof requestedLocale === "string" && isLocale(requestedLocale) ? requestedLocale : "en";

  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) redirect(`${locale === "en" ? "" : `/${locale}`}/sign-in?returnTo=%2Fwelcome`);

  await completePrincipalWelcome(session.principalId);
  redirect(`${locale === "en" ? "" : `/${locale}`}${welcomeDestination(choice)}`);
}
