import Link from "next/link";

const sections = [
  [
    "Overview",
    [
      ["Introduction", "/docs"],
      ["How it works", "/docs/how-it-works"],
    ],
  ],
  [
    "Protocol",
    [
      ["Smart contracts", "/docs/smart-contracts"],
      ["Tech stack", "/docs/tech-stack"],
    ],
  ],
  [
    "Integrate",
    [
      ["SDK", "/docs/sdk"],
      ["For agents", "/docs/ai"],
      ["API errors", "/docs/ai/errors"],
    ],
  ],
] as const;

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 md:grid-cols-[13rem_minmax(0,1fr)] sm:py-14">
      <aside className="h-fit border-l border-white/10 pl-5 md:sticky md:top-8">
        <p className="mb-6 font-mono text-xs uppercase tracking-[0.25em] text-base-content/45">Documentation</p>
        <nav aria-label="Documentation" className="space-y-7">
          {sections.map(([section, links]) => (
            <div key={section}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-base-content/45">{section}</h2>
              <ul className="space-y-1">
                {links.map(([label, href]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="block py-1.5 text-sm text-base-content/70 transition-colors hover:text-base-content"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="docs-prose min-w-0">{children}</div>
    </div>
  );
}
