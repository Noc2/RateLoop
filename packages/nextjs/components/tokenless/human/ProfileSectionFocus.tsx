"use client";

import { useEffect } from "react";
import type { HumanProfileSection } from "./humanProfileNavigation";

export function ProfileSectionFocus({ section }: { section?: HumanProfileSection }) {
  useEffect(() => {
    if (!section) return;
    const target = document.getElementById(section);
    if (!target) return;
    target.scrollIntoView({ block: "start" });
  }, [section]);

  return null;
}
