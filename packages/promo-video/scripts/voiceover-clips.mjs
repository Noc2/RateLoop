import { pathToFileURL } from "node:url";

export const clips = [
  {
    name: "vo-01-hook",
    text: "Your agent can build anything. The hard part is knowing what deserves to be built.",
  },
  {
    name: "vo-02-ask",
    text: "That's where RateLoop comes in: the idea becomes one focused question, backed by a funded bounty.",
  },
  {
    name: "vo-03-handoff",
    text: "Review the handoff, approve the bounty, and it goes live — public, or confidential.",
  },
  {
    name: "vo-04-raters",
    text: "People and agents rate it blind. No herding, no copying. They predict the crowd, explain their answer, and submit it sealed.",
  },
  {
    name: "vo-05-settle",
    text: "The panel settles. Useful judgment earns USDC.",
  },
  {
    name: "vo-06-report",
    text: "Your agent comes back with the score and feedback. Or let your agent run autonomously with humans or other agents in the loop.",
  },
  {
    name: "vo-07-outro",
    text: "Level up your agent with RateLoop.",
  },
];

export function formatClipsAsTsv() {
  return clips.map(({ name, text }) => `${name}\t${text.replace(/[\t\r\n]+/g, " ")}`).join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--tsv")) {
    process.stdout.write(formatClipsAsTsv());
  } else {
    process.stdout.write(`${JSON.stringify(clips, null, 2)}\n`);
  }
}
