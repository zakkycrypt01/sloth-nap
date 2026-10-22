import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Chore, Forecast } from "./types.ts";

function sigmoid(z: number): number {
  const clipped = Math.max(-20, Math.min(20, z));
  return 1 / (1 + Math.exp(-clipped));
}

/**
 * Tiny logistic model over "will I skip this again?"
 * TabPFN replaces these weights when python/tabpfn_forecast.py can import it.
 * skipped_last_4 is the label source: 3 or 4 skips out of the last 4 tries.
 */
export function forecastSkips(rows: Chore[]): Forecast[] {
  if (rows.length === 0) return [];
  const features = rows.map((row) => [
    row.ageDays / 30,
    row.minutes / 60,
    row.dread / 5,
    row.skippedLast4 / 4,
  ]);
  const labels = rows.map((row) => (row.skippedLast4 >= 3 ? 1 : 0));
  const weights = [0, 0, 0, 0];
  let bias = 0;
  const rate = 0.55;
  const epochs = 500;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const grad = [0, 0, 0, 0];
    let biasGrad = 0;
    for (let i = 0; i < features.length; i += 1) {
      const z = weights.reduce((sum, weight, j) => sum + weight * features[i][j], bias);
      const error = sigmoid(z) - labels[i];
      for (let j = 0; j < 4; j += 1) grad[j] += error * features[i][j];
      biasGrad += error;
    }
    for (let j = 0; j < 4; j += 1) weights[j] -= (rate * grad[j]) / features.length;
    bias -= (rate * biasGrad) / features.length;
  }
  return rows
    .map((row, i) => {
      const z = weights.reduce((sum, weight, j) => sum + weight * features[i][j], bias);
      return {
        task: row.task,
        minutes: row.minutes,
        skipProbability: Number(sigmoid(z).toFixed(4)),
        model: "logistic-baseline",
      };
    })
    .sort((a, b) => b.skipProbability - a.skipProbability);
}

export const SKIP_THRESHOLD = 0.6;

export function tryTabPfn(csvPath: string): Forecast[] | null {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../python/tabpfn_forecast.py");
  const result = spawnSync("python3", [script, csvPath], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const parsed = JSON.parse(result.stdout) as {
    ok?: boolean;
    forecast?: { task: string; skipProbability: number; model: string }[];
  };
  if (!parsed.ok || !parsed.forecast) return null;
  const minutesByTask = new Map<string, number>();
  const csv = readFileSync(csvPath, "utf8");
  for (const chore of csv.split(/\r?\n/).slice(1)) {
    const cells = chore.split(",");
    if (cells.length < 3) continue;
    minutesByTask.set(cells[0], Number(cells[2]));
  }
  return parsed.forecast.map((row) => ({
    task: row.task,
    minutes: minutesByTask.get(row.task) ?? 0,
    skipProbability: row.skipProbability,
    model: row.model,
  }));
}
