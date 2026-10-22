import path from "node:path";
import { localApprovalToken } from "./nap/approval.ts";
import { runNap } from "./nap/run.ts";

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) return fallback;
  return process.argv[index + 1];
}

const inboxDir = path.resolve(flag("--inbox", "inbox"));
const outDir = path.resolve(flag("--out", "out"));
const paceMs = process.argv.includes("--slow") ? 400 : 0;
const approve = process.argv.includes("--approve");
const approvalToken = approve ? localApprovalToken("archive-notes") : undefined;

const brief = await runNap({ inboxDir, outDir, paceMs, approvalToken });

console.log(brief.lines[0]);
console.log(brief.lines[1]);
console.log("");
console.log(`Saved about ${brief.minutesSaved} minutes. Archive: ${brief.risky.status}.`);
console.log(`Model: ${brief.model}. Wrote ${path.join(outDir, "morning-brief.md")}`);
if (brief.risky.status === "pending") {
  console.log("Run again with --approve to copy the notes into out/archived.");
}
