"use client";

import { useEffect, useState } from "react";

const REMOTE_MCP_URL = "https://rateloop-tokenless.vercel.app/api/mcp";

type Agent = {
  name: string;
  description: string;
  snippet: string;
};

const agents: readonly Agent[] = [
  {
    name: "Claude Code",
    description: "Run this command in the project where you use Claude Code.",
    snippet: `claude mcp add --transport http rateloop ${REMOTE_MCP_URL}`,
  },
  {
    name: "OpenAI Codex",
    description: "Run this command in Codex CLI, or add the same server in the Codex app.",
    snippet: `codex mcp add rateloop --url ${REMOTE_MCP_URL}`,
  },
  {
    name: "Cursor",
    description: "Add this server to your workspace or user MCP settings.",
    snippet: `{
  "mcpServers": {
    "rateloop": {
      "type": "http",
      "url": "${REMOTE_MCP_URL}"
    }
  }
}`,
  },
  {
    name: "GitHub Copilot",
    description: "Add this entry to .vscode/mcp.json for Copilot Agent mode.",
    snippet: `{
  "servers": {
    "rateloop": {
      "type": "http",
      "url": "${REMOTE_MCP_URL}"
    }
  }
}`,
  },
  {
    name: "Gemini CLI",
    description: "Use this remote HTTP server entry in your Gemini CLI configuration.",
    snippet: `{
  "mcpServers": {
    "rateloop": {
      "httpUrl": "${REMOTE_MCP_URL}"
    }
  }
}`,
  },
  {
    name: "OpenClaw",
    description: "Add this generic Streamable HTTP server to your OpenClaw MCP configuration.",
    snippet: `{
  "mcpServers": {
    "rateloop": {
      "type": "http",
      "url": "${REMOTE_MCP_URL}"
    }
  }
}`,
  },
] as const;

function AgentIcon({ name }: { name: string }) {
  const iconClass = "h-5 w-5 shrink-0";

  switch (name) {
    case "Claude Code":
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
        </svg>
      );
    case "Cursor":
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
        </svg>
      );
    case "GitHub Copilot":
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M23.922 16.992c-.861 1.495-5.859 5.023-11.922 5.023-6.063 0-11.061-3.528-11.922-5.023A.641.641 0 0 1 0 16.736v-2.869a.841.841 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.195 10.195 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952 1.399-1.136 3.392-2.093 6.122-2.093 2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.832.832 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256ZM12.172 11h-.344a4.323 4.323 0 0 1-.355.508C10.703 12.455 9.555 13 7.965 13c-1.725 0-2.989-.359-3.782-1.259a2.005 2.005 0 0 1-.085-.104L4 11.741v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.323 4.323 0 0 1-.355-.508h-.016.016Zm.641-2.935c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z" />
          <path d="M14.5 14.25a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Zm-5 0a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Z" />
        </svg>
      );
    case "OpenAI Codex":
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.167.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1 .19 1.499 0 3.401-2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
        </svg>
      );
    case "OpenClaw":
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M8.72 6.35L3.07 12l5.65 5.65 1.7-1.7L6.47 12l3.95-3.95-1.7-1.7zm6.56 0l-1.7 1.7L17.53 12l-3.95 3.95 1.7 1.7L20.93 12l-5.65-5.65zm-2.22-2.1l-4.3 15.5 2.18.6 4.3-15.5-2.18-.6z" />
        </svg>
      );
    case "Gemini CLI":
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L13.5 8.5L20 12L13.5 15.5L12 22L10.5 15.5L4 12L10.5 8.5L12 2Z" />
        </svg>
      );
    default:
      return null;
  }
}

export function SupportedAgentsSection() {
  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const activeAgent = agents.find(agent => agent.name === activeAgentName) ?? null;

  useEffect(() => {
    if (!activeAgent) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveAgentName(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeAgent]);

  async function copySetup() {
    if (!activeAgent) return;
    try {
      await navigator.clipboard.writeText(activeAgent.snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="relative z-20 mt-10 w-full sm:mt-12 lg:mt-32 xl:mt-40" aria-labelledby="supported-agents-title">
      <p id="supported-agents-title" className="mb-5 text-center text-base leading-7 text-base-content/70 sm:text-lg">
        Use RateLoop with your favorite AI agent
      </p>
      <div className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 px-4 pb-1 sm:gap-2.5 sm:px-0 lg:gap-3">
        {agents.map(agent => {
          const isSelected = activeAgent?.name === agent.name;
          return (
            <button
              key={agent.name}
              type="button"
              onClick={() => {
                setCopied(false);
                setActiveAgentName(agent.name);
              }}
              aria-haspopup="dialog"
              aria-expanded={isSelected}
              aria-label={`${agent.name} RateLoop setup`}
              className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors hover:border-base-content/25 hover:bg-base-content/[0.08] hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content sm:px-3.5 lg:px-4 ${isSelected ? "border-base-content bg-base-content text-base-100" : "border-base-content/10 bg-base-content/[0.055] text-base-content/76"}`}
            >
              <AgentIcon name={agent.name} />
              <span className="whitespace-nowrap text-sm font-semibold sm:text-base">{agent.name}</span>
            </button>
          );
        })}
      </div>

      {activeAgent ? (
        <div
          className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`${activeAgent.name} setup`}
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-sm"
            aria-label="Close agent setup"
            onClick={() => setActiveAgentName(null)}
          />
          <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-t-2xl border border-base-content/10 bg-base-200 shadow-2xl sm:rounded-2xl">
            <div className="flex items-center gap-3 border-b border-base-content/10 px-4 py-4 pr-14 sm:px-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-base-content/[0.08]">
                <AgentIcon name={activeAgent.name} />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">Agent setup</p>
                <h2 className="mt-1 text-lg font-semibold leading-tight text-base-content sm:text-xl">
                  {activeAgent.name}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveAgentName(null)}
              className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3 text-base-content/70 hover:text-base-content"
              aria-label="Close"
            >
              ×
            </button>
            <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
              <p className="text-base leading-7 text-base-content/70">{activeAgent.description}</p>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-base-content/45">
                  RateLoop MCP setup
                </p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-base-content/10 bg-base-300/60 p-4 font-mono text-xs leading-5 text-base-content/78">
                  {activeAgent.snippet}
                </pre>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void copySetup()}
                  className="btn btn-sm rounded-md border-base-content/10 bg-base-content/[0.06] text-base-content hover:border-base-content/20 hover:bg-base-content/[0.1]"
                >
                  {copied ? "Copied" : "Copy setup"}
                </button>
                <a
                  href="/docs/ai"
                  className="text-sm font-semibold text-base-content/65 underline decoration-base-content/25 underline-offset-4 hover:text-base-content"
                >
                  Open full agent docs
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
