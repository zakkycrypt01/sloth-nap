import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PartnerMode } from "./types.ts";

export type FetchLike = typeof fetch;

export async function summarizeWithUltramarine(
  text: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ summary: string; mode: PartnerMode }> {
  const apiKey = process.env.ULTRAMARINE_API_KEY;
  const base = process.env.ULTRAMARINE_BASE_URL;
  if (!apiKey || !base) {
    const sentences = text.replace(/\s+/g, " ").split(/(?<=[.?!])\s+/);
    const sentence =
      sentences.find((part) => /due|november|deadline|\$\d+/i.test(part)) ??
      sentences.find((part) => /renew/i.test(part)) ??
      text.slice(0, 240);
    return {
      summary: sentence.trim(),
      mode: {
        partner: "Ultramarine",
        mode: "local",
        detail: "Set ULTRAMARINE_API_KEY and ULTRAMARINE_BASE_URL to call Paper Instruments.",
      },
    };
  }
  const response = await fetchImpl(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "ultramarine",
      messages: [
        { role: "system", content: "Summarize the only action in these notes in one sentence. Include the cost if the response reports one." },
        { role: "user", content: text.slice(0, 8000) },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Ultramarine returned ${response.status}`);
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  const summary = body.choices?.[0]?.message?.content?.trim() || text.slice(0, 240);
  const cost = body.usage?.cost;
  return {
    summary,
    mode: {
      partner: "Ultramarine",
      mode: "live",
      detail: cost === undefined ? "Chat completion succeeded." : `Chat completion cost $${cost}.`,
    },
  };
}

export async function speakBrief(
  lines: [string, string],
  outDir: string,
  fetchImpl: FetchLike = fetch,
): Promise<PartnerMode> {
  const script = `${lines[0]}\n${lines[1]}\n`;
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "narration.txt"), script);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return {
      partner: "ElevenLabs",
      mode: "local",
      detail: "Wrote narration.txt. Set ELEVENLABS_API_KEY to render an mp3.",
    };
  }
  const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: script,
      model_id: "eleven_multilingual_v2",
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs returned ${response.status}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(outDir, "narration.mp3"), audio);
  return {
    partner: "ElevenLabs",
    mode: "live",
    detail: `Saved narration.mp3 (${audio.length} bytes).`,
  };
}

export async function rememberInAtlas(brief: unknown): Promise<PartnerMode> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return {
      partner: "MongoDB Atlas",
      mode: "local",
      detail: "Nap appended to memory.jsonl. Set MONGODB_URI to write Atlas.",
    };
  }
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const dbName = process.env.MONGODB_DB || "slothnap";
    await client.db(dbName).collection("naps").insertOne({ ...asRecord(brief), rememberedAt: new Date() });
    return { partner: "MongoDB Atlas", mode: "live", detail: `Inserted into ${dbName}.naps.` };
  } finally {
    await client.close();
  }
}

export async function rememberInBackboard(brief: unknown, fetchImpl: FetchLike = fetch): Promise<PartnerMode> {
  const apiKey = process.env.BACKBOARD_API_KEY;
  const base = process.env.BACKBOARD_BASE_URL;
  if (!apiKey || !base) {
    return {
      partner: "Backboard",
      mode: "local",
      detail: "Memory stayed on disk. Set BACKBOARD_API_KEY and BACKBOARD_BASE_URL for hosted memory.",
    };
  }
  const response = await fetchImpl(`${base.replace(/\/$/, "")}/v1/memories`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: JSON.stringify(brief), tags: ["sloth-nap", "morning-brief"] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Backboard returned ${response.status}`);
  return { partner: "Backboard", mode: "live", detail: "Stored the brief as assistant memory." };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : { value };
}

export async function traceWithSentry(spans: { name: string; ms: number }[]): Promise<PartnerMode> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return {
      partner: "Sentry",
      mode: "local",
      detail: `Wrote ${spans.length} spans to trace.json. Set SENTRY_DSN to send them.`,
    };
  }
  const Sentry = await import("@sentry/node");
  Sentry.init({ dsn, tracesSampleRate: 1 });
  await Sentry.startSpan({ name: "sloth-nap", op: "agent" }, async () => {
    for (const span of spans) {
      Sentry.startSpan({ name: span.name, op: "agent.step" }, () => undefined);
    }
  });
  await Sentry.flush(2000);
  return { partner: "Sentry", mode: "live", detail: `Flushed ${spans.length} spans.` };
}
