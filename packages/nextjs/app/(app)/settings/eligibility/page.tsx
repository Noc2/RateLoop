import { redirect } from "next/navigation";

export default function PaidEligibilityPage() {
  redirect("/human?tab=profile&section=paid-work");
}
