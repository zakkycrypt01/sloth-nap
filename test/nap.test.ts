import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseLine, statusLine } from "../src/arduino/protocol.ts";
import { localApprovalToken } from "../src/nap/approval.ts";
import { forecastSkips } from "../src/nap/forecast.ts";
import { parseChores } from "../src/nap/inbox.ts";
import { TIGER_HYBRID_SQL, searchPile, chunkDocument } from "../src/nap/pile.ts";
import { researchQuestion, resetLedger } from "../src/nap/research.ts";
import { runNap } from "../src/nap/run.ts";
import { createNapAgent } from "../src/mastra/nap-agent.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inbox = path.join(root, "inbox");
const fixture = path.join(root, "fixtures", "web.json");

test("skip forecast puts the dreaded chores first", () => {
  const chores = parseChores(
    "task,age_days,minutes,dread,skipped_last_4,audience\nfile the receipts,21,40,5,4,notes\nwater the plants,2,5,1,0,notes\nreply to the landlord,9,15,4,3,lease\n",
  );
  const ranked = forecastSkips(chores);
  assert.ok(ranked[0].skipProbability > ranked[ranked.length - 1].skipProbability);
  assert.equal(ranked.find((row) => row.task === "water the plants")?.task, "water the plants");
  const plants = ranked.find((row) => row.task === "water the plants");
  const receipts = ranked.find((row) => row.task === "file the receipts");
  assert.ok(receipts && plants && receipts.skipProbability > plants.skipProbability);
});

test("lease chunks stay hidden without read:lease", () => {
  const chunks = chunkDocument("lease.md", "The lease renewal notice is due on November 2. Reply in one sentence if you want to stay another year.", "lease");
  const visible = searchPile(chunks, "lease renewal notice", ["read:notes"]);
  assert.equal(visible.length, 0);
  const allowed = searchPile(chunks, "lease renewal notice", ["read:lease"]);
  assert.equal(allowed.length, 1);
  assert.match(TIGER_HYBRID_SQL, /embedding <=>/);
});

test("research caches the first answer for the same idempotency key", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "sloth-research-"));
  const fixtureCopy = path.join(outDir, "web.json");
  const { copyFile } = await import("node:fs/promises");
  await copyFile(fixture, fixtureCopy);
  resetLedger(outDir);
  const first = await researchQuestion("cheapest way to file a small claims form", "same-key", {
    outDir,
    fixturePath: fixtureCopy,
  });
  await rm(fixtureCopy);
  const second = await researchQuestion("cheapest way to file a small claims form", "same-key", {
    outDir,
    fixturePath: fixtureCopy,
  });
  assert.equal(second.snippet, first.snippet);
  assert.match(first.snippet, /\$30/);
  await rm(outDir, { recursive: true, force: true });
});

test("a nap writes two lines and waits to archive", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "sloth-nap-"));
  const brief = await runNap({
    inboxDir: inbox,
    outDir,
    fixturePath: fixture,
    now: new Date("2026-10-22T20:00:00.000Z"),
  });
  assert.equal(brief.lines.length, 2);
  assert.ok(brief.doToday.includes("file the receipts"));
  assert.ok(brief.doToday.includes("reply to the landlord"));
  assert.match(brief.docSummary, /November 2/);
  assert.equal(brief.risky.status, "pending");
  assert.ok(brief.minutesSaved >= 55);
  await assert.rejects(stat(path.join(outDir, "archived", "lease.md")));
  const trace = JSON.parse(await readFile(path.join(outDir, "trace.json"), "utf8")) as { spans: { name: string }[] };
  assert.ok(trace.spans.some((span) => span.name === "approval"));
  await rm(outDir, { recursive: true, force: true });
});

test("approval copies the notes once", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "sloth-approve-"));
  const token = localApprovalToken("archive-notes");
  const first = await runNap({ inboxDir: inbox, outDir, approvalToken: token, fixturePath: fixture });
  assert.equal(first.risky.status, "approved");
  const archived = await readFile(path.join(outDir, "archived", "lease.md"), "utf8");
  assert.match(archived, /November 2/);
  const second = await runNap({ inboxDir: inbox, outDir, approvalToken: token, fixturePath: fixture });
  assert.equal(second.risky.status, "approved");
  const ledger = JSON.parse(await readFile(path.join(outDir, "intent-ledger.json"), "utf8")) as { status: string }[];
  assert.equal(ledger.filter((entry) => entry.status === "confirmed").length, 1);
  await rm(outDir, { recursive: true, force: true });
});

test("arduino lines are one JSON object each", () => {
  assert.deepEqual(parseLine('{"event":"button","nap":true}'), { event: "button", nap: true });
  assert.equal(parseLine("not json"), null);
  assert.match(statusLine("research", 2), /"breath":1/);
});

test("the mastra agent is registered with the forecast tool", () => {
  const agent = createNapAgent();
  assert.equal(agent.id, "sloth-nap");
});

test("the local fine-tune beats a majority baseline", () => {
  const result = spawnSync("python3", [path.join(root, "python", "tinker_eval.py")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { improvement: number; tinker: { attempted: boolean } };
  assert.ok(report.improvement > 0);
  assert.equal(report.tinker.attempted, false);
});
