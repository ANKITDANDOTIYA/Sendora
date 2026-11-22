import { Queue, redisConnection } from "../config/redis.js";

const CAMPAIGN_QUEUE_NAME = "campaignQueue";
const SCHEDULER_ID = "email-scheduler";
const CRON_PATTERN = "0 * * * *"; // Runs every hour

const campaignQueue = new Queue(CAMPAIGN_QUEUE_NAME, {
  connection: redisConnection,
});

/**
 * Initializes and registers the recurring hourly campaign scheduler with BullMQ.
 * Uses atomic upsert so multiple backend instances safely register the same scheduler.
 */
export async function initializeCampaignScheduler(): Promise<void> {
  console.log("[STARTUP] Initializing campaign scheduler...");
  try {
    await campaignQueue.upsertJobScheduler(
      SCHEDULER_ID,
      { pattern: CRON_PATTERN },
      {
        name: "campaign-queue",
        opts: {
          backoff: 3,
          attempts: 5,
          removeOnFail: 1000,
        },
      },
    );
    console.log(
      `[STARTUP] Campaign scheduler registered successfully (ID: '${SCHEDULER_ID}', Pattern: '${CRON_PATTERN}').`,
    );
  } catch (error: any) {
    console.error(
      `[STARTUP] Failed to register campaign scheduler '${SCHEDULER_ID}':`,
      error.message || error,
    );
    throw error;
  }
}

export { campaignQueue };
export default campaignQueue;
