import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.ts";

const address = process.env.TEMPORAL_ADDRESS || "localhost:7233";
const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  namespace: process.env.TEMPORAL_NAMESPACE || "default",
  taskQueue: "sloth-nap",
  workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
  activities,
});

await worker.run();
