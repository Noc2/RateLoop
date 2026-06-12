import React from "react";
import Link from "next/link";
import type { NextPage } from "next";
import {
  CONFIDENTIALITY_TERMS_TEXT,
  CONFIDENTIALITY_TERMS_TITLE,
  CONFIDENTIALITY_TERMS_VERSION,
} from "~~/lib/confidentiality/terms";

const ConfidentialContextTermsPage: NextPage = () => {
  return (
    <div className="legal-shell mx-auto w-full px-4 py-8">
      <Link href="/legal" className="link link-primary text-base mb-4 inline-block">
        &larr; Back to Legal
      </Link>

      <article className="prose legal-prose max-w-none">
        <h1>{CONFIDENTIALITY_TERMS_TITLE}</h1>
        <p className="readability-meta">Version {CONFIDENTIALITY_TERMS_VERSION} - Last updated: June 2026</p>

        <div className="alert alert-info my-4">
          <span>
            These are protocol-facing access terms for RateLoop-hosted gated question context. They are separate from
            the Terms of Service and Privacy Notice that may apply to a specific frontend or hosting operator.
          </span>
        </div>

        <h2>1. Signed Access Promise</h2>
        <p>Before viewing confidential context, you may be asked to sign the following wallet message promise:</p>
        <blockquote>
          <p>{CONFIDENTIALITY_TERMS_TEXT}</p>
        </blockquote>

        <h2>2. What Confidential Context Means</h2>
        <p>
          Confidential context is RateLoop-hosted material attached to a specific question and served only after the
          configured access checks pass. It may include text, images, or other hosted context that the question creator
          wants raters to inspect for that rating task without making the material generally public.
        </p>
        <p>
          These terms are an access condition for viewing that hosted context. They do not replace any separate terms
          imposed by a website, wallet, storage provider, identity provider, or other interface used to reach the
          RateLoop Protocol.
        </p>

        <h2>3. Restricted Use</h2>
        <p>When you access confidential context, you must not:</p>
        <ul>
          <li>Record, copy, screenshot, scrape, download, mirror, or otherwise preserve the material</li>
          <li>Share links, files, watermarked media, summaries, excerpts, or screenshots with anyone else</li>
          <li>Publish or discuss the material outside the rating task that required access</li>
          <li>
            Use the material for a competing task, dataset, model training workflow, or unrelated commercial purpose
          </li>
          <li>Bypass, interfere with, or misrepresent the configured gated-context access checks</li>
        </ul>

        <h2>4. Access Logs, Watermarks, and Evidence</h2>
        <p>
          Confidential context is a serving-layer access restriction, not a guarantee that disclosure is impossible. A
          frontend, context host, or protocol-adjacent service may watermark served media, create signed view tokens,
          log access events, publish evidence hashes, or submit suspected breaches to moderation or governance review.
        </p>

        <h2>5. Bonds and Consequences</h2>
        <p>
          Some confidential-context questions require a bond before the hosted context can be viewed or rated. A proven
          confidentiality breach may result in loss of gated-context access, loss or slashing of a posted
          confidentiality bond, clawback or denial of pending rewards where applicable rules allow it, reputation
          consequences, and governance-approved restrictions on future surplus earning paths.
        </p>

        <h2>6. Disclosure After Settlement</h2>
        <p>
          Some questions may disclose hosted context after settlement, while others may remain private. The configured
          disclosure policy for a question controls whether the host should later make the material public. Until that
          policy permits disclosure, the restrictions in these terms continue to apply.
        </p>

        <h2>7. Versioning</h2>
        <p>
          Wallet acceptance records may bind the question, wallet address, terms version, terms URI, and a hash of the
          signed terms payload. If these terms materially change, a new terms version may be required before viewing
          newly gated context.
        </p>

        <p>
          For operator-specific service terms and privacy disclosures, review the{" "}
          <Link href="/legal/terms" className="link link-primary">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="link link-primary">
            Privacy Notice
          </Link>
          .
        </p>
      </article>
    </div>
  );
};

export default ConfidentialContextTermsPage;
