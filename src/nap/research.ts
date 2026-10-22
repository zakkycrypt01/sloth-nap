import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResearchHit } from "./types.ts";

export type FetchLike = typeof fetch;

type Ledger = Map<string, ResearchHit>;

const ledgers = new Map<string, Ledger>();

export function ledgerFor(outDir: string): Ledger {
  const existing = ledgers.get(outDir);
  if (existing) return existing;
  const created: Ledger = new Map();
  ledgers.set(outDir, created);
  return created;
}

export function resetLedger(outDir: string): void {
  ledgers.delete(outDir);
}

async function localHit(question: string, fixturePath: string): Promise<ResearchHit> {
  const raw = await readFile(fixturePath, "utf8");
  const fixtures = JSON.parse(raw) as { match: string; title: string; url: string; snippet: string; pageText: string }[];
  const found = fixtures.find((fixture) => question.toLowerCase().includes(fixture.match));
  const hit = found ?? {
    title: "No local page for that question",
    url: "fixture://none",
    snippet: "Add a SERPAPI_KEY to look this up live.",
    pageText: "",
  };
  return { ...hit, mode: "local" };
}

async function serpSearch(question: string, apiKey: string, fetchImpl: FetchLike): Promise<{ title: string; url: string; snippet: string } | null> {
  const endpoint = new URL("https://serpapi.com/search.json");
  endpoint.searchParams.set("engine", "google");
  endpoint.searchParams.set("q", question);
  endpoint.searchParams.set("api_key", apiKey);
  const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`SerpApi returned ${response.status}`);
  }
  const body = (await response.json()) as {
    organic_results?: { title?: string; link?: string; snippet?: string }[];
  };
  const top = body.organic_results?.[0];
  if (!top?.link) return null;
  return {
    title: top.title ?? top.link,
    url: top.link,
    snippet: top.snippet ?? "",
  };
}

type StagehandLike = {
  init: () => Promise<void>;
  close: () => Promise<void>;
  context: {
    pages: () => {
      goto: (url: string, opts: { waitUntil: string }) => Promise<void>;
      evaluate: (fn: () => string) => Promise<string>;
    }[];
  };
};

async function readWithBrowserbase(url: string, _fetchImpl: FetchLike): Promise<string | null> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  const specifier = "@browserbasehq/stagehand";
  const loaded = (await import(specifier)) as { Stagehand: new (opts: { env: string; apiKey: string; projectId: string }) => StagehandLike };
  const stagehand = new loaded.Stagehand({ env: "BROWSERBASE", apiKey, projectId });
  await stagehand.init();
  try {
    const page = stagehand.context.pages()[0];
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? "");
    return text.replace(/\s+/g, " ").trim();
  } finally {
    await stagehand.close();
  }
}

/**
 * Reads are safe to retry. The idempotency key still caches the first answer
 * so a Temporal retry does not spend a second SerpApi call on the same question.
 */
export async function researchQuestion(
  question: string,
  idempotencyKey: string,
  options: { outDir: string; fixturePath: string; fetchImpl?: FetchLike },
): Promise<ResearchHit> {
  const ledger = ledgerFor(options.outDir);
  const cached = ledger.get(idempotencyKey);
  if (cached) return { ...cached, mode: cached.mode };

  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = process.env.SERPAPI_KEY;
  if (apiKey) {
    const top = await serpSearch(question, apiKey, fetchImpl);
    if (top) {
      const pageText = (await readWithBrowserbase(top.url, fetchImpl)) ?? top.snippet;
      const hit: ResearchHit = { ...top, pageText, mode: "live" };
      ledger.set(idempotencyKey, hit);
      return hit;
    }
  }

  const local = await localHit(question, options.fixturePath);
  ledger.set(idempotencyKey, local);
  return local;
}

export function fixturePathFromHere(root: string): string {
  return path.join(root, "fixtures", "web.json");
}
