import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import { forecastSkips } from "../nap/forecast.ts";
import type { Chore, Forecast } from "../nap/types.ts";

export const forecastTool = createTool({
  id: "forecast-skips",
  description: "Rank chores by how likely the human is to skip them again.",
  inputSchema: z.object({
    chores: z.array(
      z.object({
        task: z.string(),
        ageDays: z.number(),
        minutes: z.number(),
        dread: z.number(),
        skippedLast4: z.number(),
        audience: z.enum(["notes", "lease"]),
      }),
    ),
  }),
  execute: async ({ chores }) => forecastSkips(chores),
});

export function createNapAgent(): Agent {
  const memory = new Memory({
    storage: new LibSQLStore({ id: "sloth-nap", url: ":memory:" }),
    options: { lastMessages: 12 },
  });
  return new Agent({
    id: "sloth-nap",
    name: "Sloth Nap",
    instructions:
      "You do the dreaded chores while the human naps. Use forecast-skips before you tell them what to do. Two lines only. Never archive notes unless a person approved it.",
    model: `ollama/${process.env.GEMMA_MODEL || "gemma2:2b"}`,
    tools: { forecastSkips: forecastTool },
    memory,
  });
}

export async function rankWithMastra(chores: Chore[]): Promise<Forecast[]> {
  const execute = forecastTool.execute;
  if (!execute) return forecastSkips(chores);
  const ranked = await execute({ chores }, {} as never);
  return ranked as Forecast[];
}
