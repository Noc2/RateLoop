import { redirect } from "next/navigation";

export default function PaidEligibilityPage() {
  redirect("/human/profile?section=paid-work");
}
