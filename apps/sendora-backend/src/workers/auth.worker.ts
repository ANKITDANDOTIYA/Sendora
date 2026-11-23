import { Worker } from "bullmq";
import { createRedisClient } from "../config/redis.js";
import { processAuthJob } from "../jobs/authenticate-pocketbase.js";

const authWorker = new Worker(
  "authQueue",
  async () => {
    await processAuthJob();
  },
  { connection: createRedisClient() },
);

authWorker.on("error", (err) => {
  console.error(`[WORKER] Auth worker error: ${err.message}`);
});

export { authWorker };
