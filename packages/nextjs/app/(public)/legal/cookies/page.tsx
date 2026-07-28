import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cookies and browser storage" };

export default function CookiesPage() {
  return (
    <article className="prose legal-prose mx-auto max-w-4xl px-4 py-12">
      <Link href="/legal">&larr; Legal</Link>
      <h1>Cookies and browser storage</h1>
      <p>Last updated: July 2026</p>
      <p>
        RateLoop does not use advertising cookies, cross-site profiling, or audience analytics. The service uses
        strictly necessary first-party cookies and limited browser storage to provide authentication, security,
        requested drafts, and optional recovery or integration preferences.
      </p>

      <h2>Strictly necessary cookies</h2>
      <ul>
        <li>
          <strong>__Host-rateloop-session</strong> (or <strong>rateloop-session</strong> in local development): a random
          RateLoop application-session credential. The server stores only its hash. It is HttpOnly, same-site, and
          expires after up to 12 hours or earlier on logout/revocation.
        </li>
        <li>
          <strong>rateloop-identity session and transaction cookies</strong>: self-hosted Better Auth cookies used for
          one-time-code, passkey, SSO, and configured Google or Apple sign-in, including anti-forgery and redirect
          state. They expire under the authentication transaction or session lifetime and are cleared on logout where
          applicable.
        </li>
      </ul>
      <p>
        These cookies are necessary to authenticate the request and protect account mutations. Blocking them prevents
        sign-in and protected workspace use.
      </p>

      <h2>Local and session storage</h2>
      <ul>
        <li>
          <strong>Review drafts:</strong> private-review drafts use session storage and expire with the assignment or
          browser session; public-review drafts may use local storage so the user can resume them. Draft storage is
          principal-scoped, bounded, and cleared when ownership changes or the stored expiry passes.
        </li>
        <li>
          <strong>Paid-eligibility handoff state:</strong> session storage holds short-lived anti-forgery state during
          an identity-provider handoff and removes it after completion.
        </li>
        <li>
          <strong>Optional device recovery:</strong> when a reviewer creates a recovery package, local storage keeps the
          encrypted recovery record on that device until the user removes it or clears site data. RateLoop cannot
          restore browser storage that the user deletes.
        </li>
        <li>
          <strong>Integration choice:</strong> local storage may remember the agent host selected for a workspace. It is
          a convenience preference and can be removed by resetting the choice or clearing site data.
        </li>
        <li>
          <strong>Optional wallet libraries:</strong> if a user explicitly opens an optional wallet flow, the wallet
          provider may use browser storage needed for connection and recovery under its own policy.
        </li>
      </ul>

      <h2>External media</h2>
      <p>
        Attached YouTube media is displayed as a local preview first. RateLoop contacts the youtube-nocookie.com
        privacy-enhanced player only after the user chooses play. Google may then receive network and device information
        and may place or read storage under its own policy. Playing the video is optional.
      </p>

      <h2>Consent and controls</h2>
      <p>
        Because RateLoop does not place non-essential analytics or advertising cookies, it does not show a consent
        banner for those purposes. If RateLoop later proposes a non-essential browser identifier, it will update this
        policy and obtain any required consent before activating it. Users can clear RateLoop cookies and site storage
        in their browser, but doing so signs them out and can permanently remove unsent drafts or local recovery
        material.
      </p>
      <p>
        Questions can be sent to hawigxyz@proton.me. See the <Link href="/legal/privacy">privacy notice</Link> for
        processing purposes, recipients, retention, and rights.
      </p>
    </article>
  );
}
