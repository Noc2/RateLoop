import React from "react";
import Link from "next/link";
import {
  CONFIDENTIALITY_TERMS_INTRO,
  CONFIDENTIALITY_TERMS_OPERATOR_NOTICE_PREFIX,
  CONFIDENTIALITY_TERMS_SECTIONS,
  type ConfidentialityTermsBlock,
} from "~~/lib/confidentiality/terms";

function ConfidentialityTermsBlockView({ block, compact }: { block: ConfidentialityTermsBlock; compact: boolean }) {
  if (block.type === "quote") {
    return (
      <blockquote
        className={
          compact ? "rounded-md border-l-4 border-primary/50 bg-base-200/80 px-4 py-3 text-base-content/85" : undefined
        }
      >
        <p>{block.text}</p>
      </blockquote>
    );
  }

  if (block.type === "list") {
    return (
      <ul className={compact ? "ml-5 list-disc space-y-2" : undefined}>
        {block.items.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  return <p>{block.text}</p>;
}

export function ConfidentialityTermsBody({ compact = false }: { compact?: boolean }) {
  const linkClassName = compact ? "link link-primary font-medium" : "link link-primary";

  return (
    <>
      <div
        className={
          compact ? "rounded-md border border-info/20 bg-info/10 p-3 text-base-content/80" : "alert alert-info my-4"
        }
      >
        <span>{CONFIDENTIALITY_TERMS_INTRO}</span>
      </div>

      {CONFIDENTIALITY_TERMS_SECTIONS.map(section => (
        <section key={section.heading} className={compact ? "space-y-2" : undefined}>
          <h2 className={compact ? "text-base font-semibold leading-tight text-base-content" : undefined}>
            {section.heading}
          </h2>
          {section.blocks.map((block, index) => (
            <ConfidentialityTermsBlockView
              key={`${section.heading}-${block.type}-${index}`}
              block={block}
              compact={compact}
            />
          ))}
        </section>
      ))}

      <p>
        {CONFIDENTIALITY_TERMS_OPERATOR_NOTICE_PREFIX}
        <Link href="/legal/terms" className={linkClassName}>
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className={linkClassName}>
          Privacy Notice
        </Link>
        .
      </p>
    </>
  );
}
