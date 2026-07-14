import { redirect } from "next/navigation";

export default function AccountProfilePage() {
  redirect("/human?tab=profile");
}
