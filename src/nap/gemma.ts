import type { Forecast, ResearchHit, ScoredChunk } from "./types.ts";

export type FetchLike = typeof fetch;

export type BriefDraft = {
  lines: [string, string];
  model: string;
  mode: "gemma" | "template";
};

function clip(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function templateBrief(input: {
  doToday: string[];
  leaveForLater: string[];
  pile: ScoredChunk[];
  research: ResearchHit | null;
  docSummary: string;
}): BriefDraft {
  const today = input.doToday.slice(0, 2);
  const later = input.leaveForLater.slice(0, 2);
  const due = input.docSummary || input.pile[0]?.text || "Nothing in the pile needs you today.";
  const line1 = today.length
    ? `Do ${today.join(" and ")}. Those are the chores you keep skipping.`
    : "Nothing is about to slip. Stay in the hammock.";
  const researchBit = input.research?.snippet ? ` ${input.research.snippet}` : "";
  const line2 = `${due} Leave ${later.join(" and ") || "the rest"} for later.${researchBit}`;
  return {
    lines: [clip(line1), clip(line2)],
    model: "template",
    mode: "template",
  };
}

function twoLines(text: string): [string, string] | null {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  return [clip(lines[0]), clip(lines[1])];
}

export async function draftWithGemma(
  input: {
    doToday: string[];
    leaveForLater: string[];
    pile: ScoredChunk[];
    research: ResearchHit | null;
    docSummary: string;
    forecast: Forecast[];
  },
  fetchImpl: FetchLike = fetch,
): Promise<BriefDraft> {
  const fallback = templateBrief(input);
  if (process.env.OLLAMA_BASE_URL === "off") return fallback;
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.GEMMA_MODEL || "gemma2:2b";
  const prompt = [
    "Write exactly two short lines for a morning brief.",
    "Line 1: the chores worth doing today, and why.",
    "Line 2: the one fact from the notes, then what to ignore.",
    `Do today: ${input.doToday.join(", ") || "none"}.`,
    `Leave for later: ${input.leaveForLater.join(", ") || "none"}.`,
    `Note: ${input.docSummary || input.pile[0]?.text || "none"}`,
    `Lookup: ${input.research?.snippet ?? "none"}.`,
    "No preamble.",
  ].join("\n");
  try {
    const response = await fetchImpl(`${base.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You are a sloth. You save the human effort. Two lines only.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return fallback;
    const body = (await response.json()) as { message?: { content?: string } };
    const parsed = twoLines(body.message?.content ?? "");
    if (!parsed) return fallback;
    return { lines: parsed, model, mode: "gemma" };
  } catch {
    return fallback;
  }
}
