export const WELCOME_DESTINATIONS = {
  agent: "/agents/overview",
  invitation: "/human/review?invite=1",
  review: "/human/review",
} as const;

export type WelcomeChoice = keyof typeof WELCOME_DESTINATIONS;

export function parseWelcomeChoice(value: FormDataEntryValue | null): WelcomeChoice | null {
  if (typeof value !== "string") return null;
  return Object.hasOwn(WELCOME_DESTINATIONS, value) ? (value as WelcomeChoice) : null;
}

export function welcomeDestination(choice: WelcomeChoice) {
  return WELCOME_DESTINATIONS[choice];
}
