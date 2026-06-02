import { AgentAskHandoffPage } from "~~/components/agent/AgentAskHandoffPage";

export const dynamic = "force-dynamic";

export default async function AgentAskHandoffRoutePage({ params }: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await params;
  return <AgentAskHandoffPage handoffId={handoffId} />;
}
