export const DOCS_NAV = [
  {
    section: "Start Here",
    links: [
      { label: "Introduction", href: "/docs" },
      { label: "How It Works", href: "/docs/how-it-works" },
      { label: "Use Cases", href: "/docs/use-cases" },
    ],
  },
  {
    section: "Platform",
    links: [
      { label: "Human Oversight", href: "/docs/human-oversight" },
      { label: "Evidence", href: "/docs/evidence" },
      { label: "Verify Evidence", href: "/docs/evidence/verify" },
      { label: "Connect a Host", href: "/docs/connect" },
      { label: "Agents & MCP", href: "/docs/ai" },
      { label: "Tech Stack", href: "/docs/tech-stack" },
      { label: "Smart Contracts", href: "/docs/smart-contracts" },
    ],
  },
  {
    section: "Build",
    links: [
      { label: "SDK", href: "/docs/sdk" },
      { label: "API Errors", href: "/docs/ai/errors" },
    ],
  },
] as const;

const DOCS_NAV_HREFS = DOCS_NAV.flatMap(group => group.links.map(link => link.href));

export function resolveActiveDocsHref(pathname: string): string | null {
  let activeHref: string | null = null;

  for (const href of DOCS_NAV_HREFS) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (activeHref === null || href.length > activeHref.length)) activeHref = href;
  }

  return activeHref;
}
