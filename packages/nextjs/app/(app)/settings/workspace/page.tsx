import { redirect } from "next/navigation";

export default function WorkspaceSettingsPage() {
  redirect("/agents?tab=overview");
}
