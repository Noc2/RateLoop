import type { Metadata } from "next";
import { BetterAuthSignIn } from "~~/components/auth/BetterAuthSignIn";
import { SignInSurface } from "~~/components/auth/SignInSurface";
import {
  LocalizedPublicContent,
  resolvePublicLocale,
  translatePublicString,
} from "~~/components/docs/LocalizedPublicContent";

export async function generateMetadata({ params }: { params: Promise<{ locale?: string }> }): Promise<Metadata> {
  const locale = await resolvePublicLocale(params);
  return {
    title: translatePublicString("Sign in", locale, "site"),
    description: translatePublicString("Sign in to your RateLoop account.", locale, "site"),
  };
}

export default async function SignInPage({ params }: { params?: Promise<{ locale?: string }> }) {
  const locale = await resolvePublicLocale(params);
  return (
    <LocalizedPublicContent locale={locale} section="site">
      <SignInSurface branded title="Sign in" titleId="sign-in-title">
        <div className="mt-6 text-left">
          <BetterAuthSignIn />
        </div>
      </SignInSurface>
    </LocalizedPublicContent>
  );
}
