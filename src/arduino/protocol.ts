export type ArduinoEvent =
  | { event: "button"; nap: boolean }
  | { event: "status"; phase: string; breath: number };

export function parseLine(line: string): ArduinoEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.event === "button" && typeof record.nap === "boolean") {
    return { event: "button", nap: record.nap };
  }
  if (record.event === "status" && typeof record.phase === "string" && typeof record.breath === "number") {
    return { event: "status", phase: record.phase, breath: record.breath };
  }
  return null;
}

export function statusLine(phase: string, breath: number): string {
  const clamped = Math.max(0, Math.min(1, breath));
  return JSON.stringify({ event: "status", phase, breath: Number(clamped.toFixed(2)) });
}
