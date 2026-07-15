import Link from "next/link";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { HumanAssuranceRaterClient } from "~~/components/tokenless/HumanAssuranceRaterClient";
import { PaidEligibilityClient } from "~~/components/tokenless/PaidEligibilityClient";
import { InvitationRouterPanel } from "~~/components/tokenless/account/InvitationRouterPanel";
import { NotificationSettingsPanel } from "~~/components/tokenless/account/NotificationSettingsPanel";
import { ProfileClient } from "~~/components/tokenless/account/ProfileClient";
import { AnswerPageClient } from "~~/components/tokenless/answer/AnswerPageClient";
import { type HumanTab, HumanTabs } from "~~/components/tokenless/human/HumanTabs";
import { PrivateGroupMembershipsPanel } from "~~/components/tokenless/human/PrivateGroupMembershipsPanel";
import { WorldIdProfilePanel } from "~~/components/tokenless/human/WorldIdProfilePanel";
import { AnswerSearch } from "~~/components/tokenless/navigation/AnswerSearch";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

const HUMAN_TABS = new Set<HumanTab>(["discover", "profile", "settings"]);
const PROFILE_SECTIONS = new Set([
  "profile",
  "invitations",
  "private-group",
  "more",
  "proof-of-human",
  "paid-work",
  "notifications",
]);

function SectionBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex text-sm font-medium text-base-content/60 hover:text-base-content">
      ← {label}
    </Link>
  );
}

function ProfileOverview() {
  return (
    <section className="surface-card rounded-2xl p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Your account</p>
      <h1 className="mt-2 text-2xl font-semibold">Profile and access</h1>
      <div className="mt-5 divide-y divide-white/10">
        <Link
          href="/human?tab=profile&section=profile"
          className="flex items-center justify-between gap-4 py-4 first:pt-0 hover:text-white"
        >
          <span>
            <strong className="block">Profile</strong>
            <span className="mt-1 block text-sm text-base-content/55">Name and sign-in details</span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/human?tab=profile&section=invitations"
          className="flex items-center justify-between gap-4 py-4 hover:text-white"
        >
          <span>
            <strong className="block">Invitations and groups</strong>
            <span className="mt-1 block text-sm text-base-content/55">Add an invitation or manage access</span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/human?tab=profile&section=more"
          className="flex items-center justify-between gap-4 py-4 last:pb-0 hover:text-white"
        >
          <span>
            <strong className="block">More options</strong>
            <span className="mt-1 block text-sm text-base-content/55">Optional account checks</span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

function MoreProfileOptions({ worldIdEnabled }: { worldIdEnabled: boolean }) {
  return (
    <section className="surface-card rounded-2xl p-6">
      <SectionBackLink href="/human?tab=profile" label="Profile" />
      <h1 className="mt-5 text-2xl font-semibold">More options</h1>
      <div className="mt-5 divide-y divide-white/10">
        {worldIdEnabled ? (
          <Link
            href="/human?tab=profile&section=proof-of-human"
            className="flex items-center justify-between gap-4 py-4 first:pt-0 hover:text-white"
          >
            <span>
              <strong className="block">Proof of Human</strong>
              <span className="mt-1 block text-sm text-base-content/55">Optional World ID enrollment</span>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}
        <Link
          href="/human?tab=profile&section=paid-work"
          className="flex items-center justify-between gap-4 py-4 last:pb-0 hover:text-white"
        >
          <span>
            <strong className="block">Paid work</strong>
            <span className="mt-1 block text-sm text-base-content/55">
              Complete eligibility before paid assignments
            </span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

function SettingsOverview() {
  return (
    <section className="surface-card rounded-2xl p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Notifications</p>
      <div className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Current channels</h1>
          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex gap-3">
              <dt className="text-base-content/55">In app</dt>
              <dd className="font-medium">On</dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-base-content/55">Browser and email</dt>
              <dd className="font-medium">Optional</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-base-content/55">Account and security notifications are always required.</p>
        </div>
        <Link href="/human?tab=settings&section=notifications" className="rateloop-gradient-action px-5">
          Customize
        </Link>
      </div>
    </section>
  );
}

export default async function HumanPage({
  searchParams,
}: {
  searchParams: Promise<{
    assignment?: string | string[];
    terms?: string | string[];
    q?: string | string[];
    scope?: string | string[];
    section?: string | string[];
    tab?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = HUMAN_TABS.has(requestedTab as HumanTab) ? (requestedTab as HumanTab) : "discover";
  const assignmentId = Array.isArray(params.assignment) ? params.assignment[0] : params.assignment;
  const requestedSection = Array.isArray(params.section) ? params.section[0] : params.section;
  const worldIdEnabled = isWorldIdAssuranceEnabled();
  const selectedSection = PROFILE_SECTIONS.has(requestedSection ?? "") ? requestedSection : undefined;
  const section =
    tab === "settings"
      ? selectedSection === "notifications"
        ? selectedSection
        : undefined
      : tab === "profile" && selectedSection !== "notifications"
        ? selectedSection === "proof-of-human" && !worldIdEnabled
          ? undefined
          : selectedSection
        : undefined;

  if (assignmentId) {
    return (
      <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
        <HumanTabs active="discover" />
        <HumanAssuranceRaterClient initialAssignmentId={params.assignment} initialTermsHash={params.terms} />
      </AppPageShell>
    );
  }

  if (tab === "discover") {
    const query = Array.isArray(params.q) ? params.q[0] : params.q;
    const requestedScope = Array.isArray(params.scope) ? params.scope[0] : params.scope;
    const scope = ["all", "public", "private"].includes(requestedScope ?? "")
      ? (requestedScope as "all" | "public" | "private")
      : "all";
    return (
      <>
        <AppPageShell contentClassName="mb-4">
          <HumanTabs active={tab} />
          <div className="mt-4 max-w-2xl [&>form]:!m-0">
            <AnswerSearch />
          </div>
        </AppPageShell>
        <AnswerPageClient initialQuery={query} initialScope={scope} />
      </>
    );
  }

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <HumanTabs active={tab} />
      {tab === "profile" && !section ? <ProfileOverview /> : null}
      {tab === "profile" && section === "profile" ? (
        <>
          <SectionBackLink href="/human?tab=profile" label="Profile" />
          <ProfileClient />
        </>
      ) : null}
      {tab === "profile" && section === "invitations" ? (
        <>
          <SectionBackLink href="/human?tab=profile" label="Profile" />
          <InvitationRouterPanel />
        </>
      ) : null}
      {tab === "profile" && section === "private-group" ? (
        <>
          <SectionBackLink href="/human?tab=profile&section=invitations" label="Invitations" />
          <PrivateGroupMembershipsPanel />
        </>
      ) : null}
      {tab === "profile" && section === "more" ? <MoreProfileOptions worldIdEnabled={worldIdEnabled} /> : null}
      {tab === "profile" && section === "proof-of-human" && worldIdEnabled ? (
        <>
          <SectionBackLink href="/human?tab=profile&section=more" label="More options" />
          <WorldIdProfilePanel />
        </>
      ) : null}
      {tab === "profile" && section === "paid-work" ? (
        <section id="paid-work" className="scroll-mt-24 space-y-5">
          <SectionBackLink href="/human?tab=profile&section=more" label="More options" />
          <PaidEligibilityClient />
        </section>
      ) : null}
      {tab === "settings" && section === "notifications" ? (
        <>
          <SectionBackLink href="/human?tab=settings" label="Settings" />
          <NotificationSettingsPanel />
        </>
      ) : null}
      {tab === "settings" && section !== "notifications" ? <SettingsOverview /> : null}
    </AppPageShell>
  );
}
