import Link from "next/link";

const agents = [
  ["Claude Code", "C"],
  ["OpenAI Codex", "◈"],
  ["Cursor", "◇"],
  ["GitHub Copilot", "●"],
  ["Gemini CLI", "✦"],
  ["OpenClaw", "⌘"],
] as const;

/**
 * The landing-page entry point for the tokenless agent integration.
 *
 * Setup instructions intentionally live in /docs/ai so the landing page
 * cannot drift from the canonical four-tool MCP contract.
 */
export function SupportedAgentsSection() {
  return (
    <section className="relative z-20 mt-10 w-full sm:mt-12 lg:mt-32 xl:mt-40" aria-labelledby="supported-agents-title">
      <p id="supported-agents-title" className="mb-5 text-center text-base leading-7 text-base-content/70 sm:text-lg">
        Use RateLoop with your favorite AI agent
      </p>
      <div className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 px-4 pb-1 sm:gap-2.5 sm:px-0 lg:gap-3">
        {agents.map(([name, glyph]) => (
          <Link
            key={name}
            href="/docs/ai"
            aria-label={`${name} RateLoop setup`}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-base-content/10 bg-base-content/[0.055] px-3 py-2.5 text-base-content/76 transition-colors hover:border-base-content/25 hover:bg-base-content/[0.08] hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content sm:px-3.5 lg:px-4"
          >
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-bold"
            >
              {glyph}
            </span>
            <span className="whitespace-nowrap text-sm font-semibold sm:text-base">{name}</span>
          </Link>
        ))}
      </div>
      <p className="mt-4 text-center text-sm leading-6 text-base-content/55">
        Connect through the tokenless remote MCP server.{" "}
        <Link
          href="/docs/ai"
          className="font-semibold underline decoration-base-content/30 underline-offset-4 hover:decoration-base-content"
        >
          View setup
        </Link>
      </p>
    </section>
  );
}
