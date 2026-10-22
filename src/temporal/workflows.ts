import { condition, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type { MorningBrief } from "../nap/types.ts";
import type * as activities from "./activities.ts";

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

export const approveArchive = defineSignal<[string]>("approveArchive");

/**
 * The workflow waits for a person before the archive write.
 * Reads and the brief itself happen first. A crash mid-wait resumes here,
 * because the signal is part of the event history rather than a poll.
 */
export async function napWorkflow(input: { inboxDir: string; outDir: string }): Promise<MorningBrief> {
  let token: string | undefined;
  setHandler(approveArchive, (approvalToken) => {
    token = approvalToken;
  });
  const first = await acts.napActivity({
    ...input,
    workflowId: "nap",
  });
  if (first.risky.status === "approved") return first;
  await condition(() => token !== undefined, "7 days");
  return acts.napActivity({
    ...input,
    approvalToken: token,
    workflowId: "nap",
  });
}
