export const WELCOME_DESTINATIONS = {
  agent: "/agents",
  invitation: "/human?tab=discover&invite=1",
  review: "/human?tab=discover",
} as const;

export type WelcomeChoice = keyof typeof WELCOME_DESTINATIONS;

export function parseWelcomeChoice(value: FormDataEntryValue | null): WelcomeChoice | null {
  if (typeof value !== "string") return null;
  return value in WELCOME_DESTINATIONS ? (value as WelcomeChoice) : null;
}

export function welcomeDestination(choice: WelcomeChoice) {
  return WELCOME_DESTINATIONS[choice];
}
