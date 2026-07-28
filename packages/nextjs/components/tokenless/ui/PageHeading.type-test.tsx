import type { PageHeadingProps } from "./PageHeading";

const headingOnly = { heading: "Review" } satisfies PageHeadingProps;
const headingWithEyebrow = { eyebrow: "Private", heading: "Review" } satisfies PageHeadingProps;
const headingWithSubtitle = { heading: "Review", subtitle: "Complete the assigned work." } satisfies PageHeadingProps;
const identifiedBlueHeading = {
  accent: "blue",
  heading: "Review",
  headingId: "review-heading",
} satisfies PageHeadingProps;

// @ts-expect-error A page heading may use an eyebrow or a subtitle, but not both.
const overloadedHeading: PageHeadingProps = {
  eyebrow: "Private",
  heading: "Review",
  subtitle: "Complete the assigned work.",
};

void headingOnly;
void headingWithEyebrow;
void headingWithSubtitle;
void identifiedBlueHeading;
void overloadedHeading;
