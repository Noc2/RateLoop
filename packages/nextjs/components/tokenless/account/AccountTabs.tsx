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
    <nav aria-label="Account sections" className="mt-8 flex flex-wrap gap-2 border-b border-white/10 pb-3">
      {tabs.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className={`rounded-full border px-4 py-2 text-sm transition-colors ${
            pathname === href
              ? "border-base-content bg-base-content font-semibold text-base-100"
              : "border-white/10 text-base-content/60 hover:border-white/25 hover:text-base-content"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
