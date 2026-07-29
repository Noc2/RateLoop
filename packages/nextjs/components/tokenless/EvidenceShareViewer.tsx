"use client";

import { useEffect, useRef, useState } from "react";
import { PublicEvidenceVerifier } from "~~/components/tokenless/PublicEvidenceVerifier";
import { readJson } from "~~/lib/tokenless/http";

export function EvidenceShareViewer({ grantId }: { grantId: string }) {
  const started = useRef(false);
  const [packetJson, setPacketJson] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const secret = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    if (!secret) {
      setUnavailable(true);
      return;
    }
    void fetch(`/api/evidence/shares/${encodeURIComponent(grantId)}/redeem`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    })
      .then(response => readJson<unknown>(response))
      .then(packet => setPacketJson(JSON.stringify(packet, null, 2)))
      .catch(() => setUnavailable(true));
  }, [grantId]);

  if (unavailable) {
    return (
      <p className="mt-6 rounded-2xl border border-red-300/20 bg-red-300/[0.06] p-4 text-sm text-red-100" role="alert">
        This evidence share is unavailable. Ask the sender for a new link.
      </p>
    );
  }
  if (!packetJson) {
    return (
      <p className="mt-6 text-sm text-base-content/60" role="status">
        Opening evidence packet…
      </p>
    );
  }
  return <PublicEvidenceVerifier initialPacketJson={packetJson} />;
}
