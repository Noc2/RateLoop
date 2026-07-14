"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  ["Profile", "/settings"],
  ["Paid work", "/settings/eligibility"],
  ["Workspace & API", "/settings/workspace"],
] as const;

export function AccountTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account sections" className="flex flex-wrap gap-2">
      {tabs.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
            pathname === href ? "pill-active" : "pill-inactive"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
