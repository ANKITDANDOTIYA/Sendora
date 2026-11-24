import { Worker } from "bullmq";
import { createRedisClient } from "../config/redis.js";
import { processEmailBatchJob } from "../jobs/batch-emails.js";

const batchemailWorker = new Worker(
  "batchEmailQueue",
  async (job) => {
    console.log(`[WORKER] Processing batch... Job ID: ${job.id}`);
    // Process the batch of emails
    const results = await processEmailBatchJob(job.data);

    console.log(
      `[WORKER] Job ${job.id} completed. Processed ${results.length} emails. Waiting 1 minute before processing the next job...`,
    );

    // Wait for 1 minute (60,000 ms) before processing the next job
    await new Promise((resolve) => setTimeout(resolve, 60000));
  },
  { connection: createRedisClient(), concurrency: 1 }, // Ensuring only one job processes at a time
);

// Add event handlers for better monitoring
batchemailWorker.on("completed", (job) => {
  console.log(`[WORKER] Job ${job.id} has completed successfully`);
});

batchemailWorker.on("failed", (job, err) => {
  console.error(`[WORKER] Job ${job?.id} has failed with error: ${err.message}`);
});

batchemailWorker.on("error", (err: any) => {
  if (err?.code === "ENOTFOUND" || err?.code === "ETIMEDOUT") {
    return;
  }
  console.error(`[WORKER] Batch email worker error: ${err.message}`);
});

export { batchemailWorker };
