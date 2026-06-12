import React from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { ConfidentialityTermsBody } from "~~/components/legal/ConfidentialityTermsBody";
import { CONFIDENTIALITY_TERMS_TITLE, CONFIDENTIALITY_TERMS_VERSION } from "~~/lib/confidentiality/terms";

const ConfidentialContextTermsPage: NextPage = () => {
  return (
    <div className="legal-shell mx-auto w-full px-4 py-8">
      <Link href="/legal" className="link link-primary text-base mb-4 inline-block">
        &larr; Back to Legal
      </Link>

      <article className="prose legal-prose max-w-none">
        <h1>{CONFIDENTIALITY_TERMS_TITLE}</h1>
        <p className="readability-meta">Version {CONFIDENTIALITY_TERMS_VERSION} - Last updated: June 2026</p>

        <ConfidentialityTermsBody />
      </article>
    </div>
  );
};

export default ConfidentialContextTermsPage;
