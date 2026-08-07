import type { HumanNavigation } from "./humanNavigation";
import { humanSectionHref } from "./humanNavigation";

export const HUMAN_PROFILE_SECTIONS = [
  "paid-work",
  "earnings",
  "forecast-integrity",
  "paid-settlement",
  "feedback-bonus-claims",
] as const;

export type HumanProfileSection = (typeof HUMAN_PROFILE_SECTIONS)[number];

export function resolveHumanProfileSection(value?: string): HumanProfileSection | undefined {
  return HUMAN_PROFILE_SECTIONS.find(section => section === value);
}

export function humanAccountReturnTo(input: {
  eligibility?: string;
  section?: HumanProfileSection;
  // Every gated human surface, not only the account tabs: review and history
  // are gated on the server too, so they return here through the same helper.
  tab: HumanNavigation;
}) {
  const params = new URLSearchParams();
  if (input.section) params.set("section", input.section);
  if (input.eligibility === "provider-return") params.set("eligibility", input.eligibility);
  return humanSectionHref(input.tab, params);
}
