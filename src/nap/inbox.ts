import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Audience, Chore, Inbox } from "./types.ts";

function audienceFromName(name: string): Audience {
  return name.toLowerCase().includes("lease") ? "lease" : "notes";
}

export function parseChores(csv: string): Chore[] {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0]?.split(",").map((cell) => cell.trim());
  if (!header || header[0] !== "task") return [];
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const record = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
    const audience = record.audience === "lease" ? "lease" : "notes";
    return {
      task: record.task,
      ageDays: Number(record.age_days),
      minutes: Number(record.minutes),
      dread: Number(record.dread),
      skippedLast4: Number(record.skipped_last_4),
      audience,
    };
  });
}

export async function loadInbox(inboxDir: string): Promise<Inbox> {
  const entries = await readdir(inboxDir);
  const choresPath = path.join(inboxDir, "chores.csv");
  const chores = parseChores(await readFile(choresPath, "utf8"));
  const notes = [];
  for (const name of entries.filter((entry) => entry.endsWith(".md")).sort()) {
    const text = await readFile(path.join(inboxDir, name), "utf8");
    notes.push({ source: name, text, audience: audienceFromName(name) });
  }
  let question = "What can wait until next week?";
  if (entries.includes("question.txt")) {
    question = (await readFile(path.join(inboxDir, "question.txt"), "utf8")).trim();
  }
  return { chores, notes, question };
}

export function notePaths(inboxDir: string, notes: { source: string }[]): string[] {
  return notes.map((note) => path.join(inboxDir, note.source));
}
