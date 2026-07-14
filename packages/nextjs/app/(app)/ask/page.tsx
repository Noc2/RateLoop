import { redirect } from "next/navigation";

export default function AskPage() {
  redirect("/agents?tab=integrate&section=handoff");
}
