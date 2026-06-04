import type { ReactNode } from "react";
import {
  parseContextDocumentDisplayBlocks,
  parseContextDocumentInlineSegments,
} from "~~/lib/attachments/contextDocumentDisplay";
import { CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN } from "~~/lib/auth/contextDocumentUploadChallenge.shared";
import { sanitizeExternalUrl } from "~~/utils/externalUrl";

type ContextDocumentContentProps = {
  className?: string;
  mimeType: string;
  text: string;
};

function renderInlineText(text: string, keyPrefix: string, markdown: boolean): ReactNode {
  if (!markdown) return text;

  return parseContextDocumentInlineSegments(text).map((segment, index) => {
    const key = `${keyPrefix}-${index}`;
    if (segment.type === "code") {
      return (
        <code key={key} className="rounded-md bg-base-content/[0.08] px-1.5 py-0.5 font-mono text-[0.94em]">
          {segment.text}
        </code>
      );
    }
    if (segment.type === "strong") {
      return <strong key={key}>{segment.text}</strong>;
    }
    if (segment.type === "emphasis") {
      return <em key={key}>{segment.text}</em>;
    }
    if (segment.type === "link") {
      const safeHref = sanitizeExternalUrl(segment.href);
      return safeHref ? (
        <a key={key} href={safeHref} target="_blank" rel="noopener noreferrer">
          {segment.text}
        </a>
      ) : (
        segment.text
      );
    }
    return segment.text;
  });
}

export function ContextDocumentContent({ className = "", mimeType, text }: ContextDocumentContentProps) {
  const markdown = mimeType === CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN;
  const blocks = parseContextDocumentDisplayBlocks(text, mimeType);

  return (
    <article className={`context-document-prose prose max-w-none ${className}`.trim()}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "heading") {
          const headingClassName =
            block.depth === 1
              ? "mt-0 text-2xl font-bold leading-tight sm:text-3xl"
              : block.depth === 2
                ? "text-xl font-semibold leading-snug sm:text-2xl"
                : "text-lg font-semibold leading-snug sm:text-xl";

          if (block.depth === 1) {
            return (
              <h1 key={key} className={headingClassName}>
                {renderInlineText(block.text, key, markdown)}
              </h1>
            );
          }
          if (block.depth === 2) {
            return (
              <h2 key={key} className={headingClassName}>
                {renderInlineText(block.text, key, markdown)}
              </h2>
            );
          }
          return (
            <h3 key={key} className={headingClassName}>
              {renderInlineText(block.text, key, markdown)}
            </h3>
          );
        }

        if (block.type === "paragraph") {
          return (
            <p key={key} className="whitespace-pre-line">
              {renderInlineText(block.text, key, markdown)}
            </p>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={key}
              className="my-5 border-l-2 border-[#03CEA4] bg-base-content/[0.04] px-4 py-3 text-base-content/78"
            >
              <p className="my-0 whitespace-pre-line">{renderInlineText(block.text, key, markdown)}</p>
            </blockquote>
          );
        }

        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInlineText(item, `${key}-${itemIndex}`, markdown)}</li>
              ))}
            </ListTag>
          );
        }

        if (block.type === "code") {
          return (
            <div key={key} className="my-5 overflow-hidden rounded-lg border border-base-content/10 bg-black/35">
              {block.language ? (
                <div className="border-b border-base-content/10 px-4 py-2 font-mono text-xs uppercase tracking-wide text-base-content/48">
                  {block.language}
                </div>
              ) : null}
              <pre className="overflow-x-auto p-4 font-mono text-sm leading-6 text-base-content/82">
                <code>{block.text}</code>
              </pre>
            </div>
          );
        }

        return <hr key={key} />;
      })}
    </article>
  );
}
