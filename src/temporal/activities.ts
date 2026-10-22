import path from "node:path";
import { runNap } from "../nap/run.ts";
import type { MorningBrief } from "../nap/types.ts";

export async function napActivity(input: {
  inboxDir: string;
  outDir: string;
  approvalToken?: string;
  workflowId: string;
}): Promise<MorningBrief> {
  return runNap({
    inboxDir: path.resolve(input.inboxDir),
    outDir: path.resolve(input.outDir),
    approvalToken: input.approvalToken,
    idempotencyKey: input.workflowId,
    paceMs: 0,
  });
}
