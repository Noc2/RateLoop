export const DOCS_NAV = [
  {
    section: "Start Here",
    links: [
      { label: "Introduction", href: "/docs" },
      { label: "How It Works", href: "/docs/how-it-works" },
      { label: "For Agents", href: "/docs/ai" },
    ],
  },
  {
    section: "Protocol",
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
