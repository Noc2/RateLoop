import type { Metadata } from "next";
import {
  LocalizedPublicContent,
  type PublicLocaleParams,
  getLocalizedPublicMetadata,
  usePublicLocale,
} from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";

export function generateMetadata({ params }: { params: PublicLocaleParams }): Promise<Metadata> {
  return getLocalizedPublicMetadata({ params, section: "legal", title: "Imprint" });
}

const ImprintPage = ({ params }: { params?: PublicLocaleParams } = {}) => {
  const locale = usePublicLocale(params);
  return (
    <LocalizedPublicContent locale={locale} section="legal">
      <article className="prose legal-prose mx-auto max-w-4xl px-4 py-12">
        <Link href="/legal">&larr; Legal</Link>
        <h1>Imprint (Impressum)</h1>
        <p className="readability-meta">Information pursuant to &sect; 5 DDG (German Digital Services Act)</p>

        <h2>Interface Operator</h2>
        <p>
          Hawig Ventures UG (haftungsbeschr&auml;nkt)
          <br />
          Herzogin-Juliana-Stra&szlig;e 7<br />
          55469 Simmern
          <br />
          Germany
        </p>

        <h2>Represented by</h2>
        <p>Gesch&auml;ftsf&uuml;hrer: David Hawig</p>

        <h2>Commercial Register</h2>
        <p>HRB 24975, Amtsgericht Bad Kreuznach</p>

        <h2>Contact</h2>
        <p>Email: hawigxyz@proton.me</p>

        <h2>Responsible for Content</h2>
        <p>
          Responsible pursuant to &sect; 18 para. 2 MStV (German Interstate Media Treaty):
          <br />
          David Hawig
          <br />
          Herzogin-Juliana-Stra&szlig;e 7<br />
          55469 Simmern
          <br />
          Germany
        </p>

        <h2>Important Notice</h2>
        <p>
          This imprint applies to the RateLoop application and related services. RateLoop provides software-supported
          human assurance and settlement evidence; it does not provide banking, brokerage, custody, investment, legal,
          or medical advice.
        </p>
      </article>
    </LocalizedPublicContent>
  );
};

export default ImprintPage;
