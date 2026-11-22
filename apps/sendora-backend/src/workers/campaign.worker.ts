import { Worker } from "bullmq";
import { redis } from "../config/redis.js";
import { processCampaignJob } from "../jobs/fetch-campaigns.js";

const campaignWorker = new Worker(
  "campaignQueue",
  async (job) => {
    console.log(
      `[CAMPAIGN] Scheduler triggered. Job ID: ${job.id}, Name: ${job.name}`,
    );
    await processCampaignJob();
  },
  { connection: redis },
);

campaignWorker.on("completed", (job) => {
  console.log(`[WORKER] Campaign job ${job.id} completed successfully.`);
});

campaignWorker.on("failed", (job, err) => {
  console.error(
    `[WORKER] Campaign job ${job?.id} failed with error: ${err.message}`,
  );
});

campaignWorker.on("error", (err) => {
  console.error(`[WORKER] Campaign worker error: ${err.message}`);
});

export { campaignWorker };
