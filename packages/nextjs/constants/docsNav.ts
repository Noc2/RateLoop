export const DOCS_NAV = [
  {
    section: "Start Here",
    links: [
      { label: "Introduction", href: "/docs" },
      { label: "Use Cases", href: "/docs/use-cases" },
      { label: "How It Works", href: "/docs/how-it-works" },
      { label: "Evidence & Compliance", href: "/docs/evidence" },
      { label: "Agents & MCP", href: "/docs/ai" },
    ],
  },
  {
    section: "Settlement",
    links: [
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
