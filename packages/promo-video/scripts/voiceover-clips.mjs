import { pathToFileURL } from "node:url";

export const clips = [
  {
    name: "vo-01-hook",
    text: "AI moves fast. The hard part is knowing when an AI-enabled workflow is good enough to use.",
  },
  {
    name: "vo-02-ask",
    text: "RateLoop turns that rollout decision into one focused human-assurance panel, backed by a funded bounty.",
  },
  {
    name: "vo-03-handoff",
    text: "Review the quality criterion, audience, timing, and itemized funding before the panel starts.",
  },
  {
    name: "vo-04-raters",
    text: "Eligible people evaluate it blind. They predict the crowd, explain their answer, and submit a sealed response.",
  },
  {
    name: "vo-05-settle",
    text: "The panel settles under disclosed rules, and accepted human work follows a paid or compensated path.",
  },
  {
    name: "vo-06-report",
    text: "Your team receives the panel signal, written reasons, and settlement evidence. An accountable person still owns the rollout decision.",
  },
  {
    name: "vo-07-outro",
    text: "Add human assurance to AI-enabled workflows with RateLoop.",
  },
];

export function formatClipsAsTsv() {
  return (
    clips
      .map(({ name, text }) => `${name}\t${text.replace(/[\t\r\n]+/g, " ")}`)
      .join("\n") + "\n"
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes("--tsv")) {
    process.stdout.write(formatClipsAsTsv());
  } else {
    process.stdout.write(`${JSON.stringify(clips, null, 2)}\n`);
  }
}
