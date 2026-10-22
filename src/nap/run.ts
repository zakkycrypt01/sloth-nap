import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { settleArchive } from "./approval.ts";
import { SKIP_THRESHOLD, tryTabPfn } from "./forecast.ts";
import { rankWithMastra } from "../mastra/nap-agent.ts";
import { draftWithGemma } from "./gemma.ts";
import { loadInbox, notePaths } from "./inbox.ts";
import {
  rememberInAtlas,
  rememberInBackboard,
  speakBrief,
  summarizeWithUltramarine,
  traceWithSentry,
} from "./partners.ts";
import { chunkDocument, searchPile, searchTiger } from "./pile.ts";
import { fixturePathFromHere, researchQuestion } from "./research.ts";
import type { FetchLike } from "./research.ts";
import type { MorningBrief, PartnerMode, Span } from "./types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function timed<T>(spans: Span[], name: string, mode: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    spans.push({ name, ms: Date.now() - started, mode });
  }
}

export async function runNap(options: {
  inboxDir: string;
  outDir: string;
  paceMs?: number;
  approvalToken?: string;
  permissions?: string[];
  fetchImpl?: FetchLike;
  now?: Date;
  fixturePath?: string;
  idempotencyKey?: string;
}): Promise<MorningBrief> {
  const pace = options.paceMs ?? 0;
  const permissions = options.permissions ?? ["read:notes", "read:lease"];
  const fetchImpl = options.fetchImpl ?? fetch;
  const spans: Span[] = [];
  const partners: PartnerMode[] = [];
  await mkdir(options.outDir, { recursive: true });

  const inbox = await timed(spans, "load-inbox", "local", () => loadInbox(options.inboxDir));
  await sleep(pace);

  const forecast = await timed(spans, "forecast-skips", "local", async () => {
    const tabpfn = tryTabPfn(path.join(options.inboxDir, "chores.csv"));
    if (tabpfn) {
      partners.push({
        partner: "TabPFN",
        mode: "local",
        detail: "TabPFN ranked skip risk from the chore table.",
      });
      return tabpfn;
    }
    partners.push({
      partner: "TabPFN",
      mode: "local",
      detail: "tabpfn is not installed, so the Mastra forecast tool used the logistic baseline. See python/tabpfn_forecast.py.",
    });
    return rankWithMastra(inbox.chores);
  });
  const doToday = forecast.filter((row) => row.skipProbability >= SKIP_THRESHOLD).map((row) => row.task);
  const leaveForLater = forecast.filter((row) => row.skipProbability < SKIP_THRESHOLD).map((row) => row.task);
  await sleep(pace);

  const chunks = inbox.notes.flatMap((note) => chunkDocument(note.source, note.text, note.audience));
  const pile = await timed(spans, "search-pile", process.env.DATABASE_URL ? "tiger" : "local", async () => {
    if (process.env.DATABASE_URL) {
      try {
        const rows = await searchTiger(process.env.DATABASE_URL, chunks, inbox.question, permissions);
        partners.push({ partner: "Tiger Data", mode: "live", detail: "Hybrid pgvector search on DATABASE_URL." });
        return rows;
      } catch (error) {
        partners.push({
          partner: "Tiger Data",
          mode: "local",
          detail: `Database query failed (${error instanceof Error ? error.message : "unknown"}). Used the local ranker.`,
        });
      }
    } else {
      partners.push({
        partner: "Tiger Data",
        mode: "local",
        detail: "Same hybrid score as TIGER_HYBRID_SQL, in process. Set DATABASE_URL for Tiger.",
      });
    }
    return searchPile(chunks, inbox.question, permissions);
  });
  await sleep(pace);

  const research = await timed(spans, "research", process.env.SERPAPI_KEY ? "live" : "local", () =>
    researchQuestion(inbox.question, options.idempotencyKey ?? `research:${inbox.question}`, {
      outDir: options.outDir,
      fixturePath: options.fixturePath ?? fixturePathFromHere(root),
      fetchImpl,
    }),
  );
  partners.push({
    partner: "SerpApi",
    mode: research.mode === "live" ? "live" : "local",
    detail: research.mode === "live" ? research.url : "Answered from fixtures/web.json.",
  });
  partners.push({
    partner: "Browserbase",
    mode: process.env.BROWSERBASE_API_KEY ? "live" : "local",
    detail: process.env.BROWSERBASE_API_KEY
      ? "Stagehand opened the top result."
      : "Used the fixture page text. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to open a live browser.",
  });
  await sleep(pace);

  const docText = inbox.notes.map((note) => note.text).join("\n\n");
  const reasoned = await timed(spans, "reason-docs", "ultramarine", () => summarizeWithUltramarine(docText, fetchImpl));
  partners.push(reasoned.mode);
  await sleep(pace);

  const draft = await timed(spans, "draft-brief", "gemma", () =>
    draftWithGemma(
      {
        doToday,
        leaveForLater,
        pile,
        research,
        docSummary: reasoned.summary,
        forecast,
      },
      fetchImpl,
    ),
  );
  partners.push({
    partner: "Gemma",
    mode: draft.mode === "gemma" ? "live" : "local",
    detail: draft.mode === "gemma" ? `Ollama model ${draft.model} wrote the brief.` : "Ollama was unreachable, so the structured template wrote the two lines.",
  });
  partners.push({
    partner: "Mastra",
    mode: "local",
    detail: "forecast-skips is a Mastra tool with memory on LibSQL. Gemma via Ollama is the agent model when it is reachable.",
  });
  await sleep(pace);

  const actionId = "archive-notes";
  const risky = await timed(spans, "approval", "auth0", () =>
    settleArchive(
      {
        id: actionId,
        kind: "archive-notes",
        summary: "Copy the dreaded notes into out/archived. Nothing is deleted.",
        status: "pending",
      },
      notePaths(options.inboxDir, inbox.notes),
      options.outDir,
      options.approvalToken,
    ),
  );
  partners.push({
    partner: "Auth0",
    mode: process.env.AUTH0_DOMAIN ? "live" : "local",
    detail: risky.status === "approved"
      ? "Approval token accepted. Notes copied once."
      : "Archive is waiting. RAG chunks were filtered by read:notes and read:lease.",
  });

  const voice = await timed(spans, "speak", "elevenlabs", () => speakBrief(draft.lines, options.outDir, fetchImpl));
  partners.push(voice);

  const memoryRecord = {
    lines: draft.lines,
    doToday,
    question: inbox.question,
  };
  await writeFile(path.join(options.outDir, "memory.jsonl"), `${JSON.stringify(memoryRecord)}\n`, { flag: "a" });
  partners.push(await rememberInAtlas(memoryRecord));
  partners.push(await rememberInBackboard(memoryRecord, fetchImpl));

  const minutesSaved = forecast
    .filter((row) => row.skipProbability >= SKIP_THRESHOLD)
    .reduce((sum, row) => sum + row.minutes, 0);

  const brief: MorningBrief = {
    lines: draft.lines,
    doToday,
    leaveForLater,
    pile,
    research,
    docSummary: reasoned.summary,
    forecast,
    risky,
    model: draft.model,
    minutesSaved,
    partners,
    createdAt: (options.now ?? new Date()).toISOString(),
  };

  await mkdir(options.outDir, { recursive: true });
  await writeFile(path.join(options.outDir, "morning-brief.json"), JSON.stringify(brief, null, 2));
  await writeFile(
    path.join(options.outDir, "morning-brief.md"),
    `# Morning brief\n\n${brief.lines[0]}\n\n${brief.lines[1]}\n\nAbout ${brief.minutesSaved} minutes of dreaded chores, handled while you napped.\n`,
  );
  await writeFile(path.join(options.outDir, "trace.json"), JSON.stringify({ spans }, null, 2));
  await writeFile(
    path.join(options.outDir, "session.json"),
    JSON.stringify(
      {
        project: "sloth-nap",
        why: "Each step is a side effect the workflow can retry without redoing a write.",
        steps: spans.map((span) => ({
          name: span.name,
          why: stepWhy(span.name),
          ms: span.ms,
          mode: span.mode,
        })),
      },
      null,
      2,
    ),
  );
  partners.push(await traceWithSentry(spans));
  partners.push({
    partner: "Entire",
    mode: "local",
    detail: "session.json records why each step exists, for the write-up.",
  });
  partners.push({
    partner: "Temporal",
    mode: "local",
    detail: "src/temporal/workflows.ts is the durable nap. This process ran the same activities in order.",
  });
  brief.partners = partners;
  await writeFile(path.join(options.outDir, "morning-brief.json"), JSON.stringify(brief, null, 2));
  return brief;
}

function stepWhy(name: string): string {
  const reasons: Record<string, string> = {
    "load-inbox": "The pile has to be on disk before any model sees it, so a restart can reload the same chores.",
    "forecast-skips": "Skip risk decides what is worth doing. The rest can wait.",
    "search-pile": "The lease date is buried in notes the human does not want to reread.",
    research: "One lookup replaces a tab the human would open and forget.",
    "reason-docs": "A single sentence is the action hiding in the rambling note.",
    "draft-brief": "Gemma, when it is reachable, turns those facts into two lines.",
    approval: "Archiving notes is a write. It waits for a person, and the intent ledger blocks a double copy.",
    speak: "Hearing two lines is less work than reading the pile.",
  };
  return reasons[name] ?? name;
}
