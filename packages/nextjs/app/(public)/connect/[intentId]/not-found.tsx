import Link from "next/link";
import { Card } from "~~/components/tokenless/ui/Card";

export default function AgentConnectionNotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:py-16">
      <Card as="section" className="rounded-2xl p-6 sm:p-8" aria-labelledby="connection-unavailable-heading">
        <p className="font-mono text-xs uppercase tracking-widest text-error">Connection unavailable</p>
        <h1 id="connection-unavailable-heading" className="mt-3 text-3xl font-semibold">
          This connection link is no longer available
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-base-content/70">
          The link may be invalid, expired, or replaced. Open Connection in your workspace to create a new connection
          message.
        </p>
        <Link href="/agents/connections" className="btn btn-primary mt-6">
          Open Connection
        </Link>
      </Card>
    </div>
  );
}
