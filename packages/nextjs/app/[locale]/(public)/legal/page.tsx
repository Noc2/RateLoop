import type { Metadata } from "next";
import {
  LocalizedPublicContent,
  type PublicLocaleParams,
  getLocalizedPublicMetadata,
  usePublicLocale,
} from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { Card } from "~~/components/tokenless/ui/Card";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";

export function generateMetadata({ params }: { params: PublicLocaleParams }): Promise<Metadata> {
  return getLocalizedPublicMetadata({ params, section: "legal", title: "Legal" });
}

const documents = [
  ["Terms", "/legal/terms", "Rules, responsibilities, payment terms, and service limitations."],
  [
    "Privacy notice",
    "/legal/privacy",
    "What RateLoop stores, why it is processed, and what may become public on-chain.",
  ],
  ["Data processing addendum", "/legal/dpa", "Article 28 terms for customer-controlled personal data."],
  ["Subprocessors", "/legal/subprocessors", "Service providers, purposes, feature conditions, and change notices."],
  ["Cookies and storage", "/legal/cookies", "Strictly necessary cookies and browser storage used by the service."],
  ["Imprint", "/legal/imprint", "Operator and contact information."],
] as const;

export default function LegalPage({ params }: { params?: PublicLocaleParams } = {}) {
  const locale = usePublicLocale(params);
  return (
    <LocalizedPublicContent locale={locale} section="legal">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
        <PageHeading accent="pink" heading="Legal" />
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {documents.map(([title, href, description], index) => (
            <Card
              as={Link}
              variant="marketing"
              key={href}
              href={href}
              className="group border-l-2 p-6"
              style={{
                borderLeftColor: ["var(--rateloop-blue)", "var(--rateloop-green)", "var(--rateloop-pink)"][index % 3],
              }}
            >
              <h2 className="text-lg font-semibold transition-colors group-hover:text-base-content">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-base-content/50">{description}</p>
            </Card>
          ))}
        </div>
      </div>
    </LocalizedPublicContent>
  );
}
