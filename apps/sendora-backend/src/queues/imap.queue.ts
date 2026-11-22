import { Queue, redisConnection } from "../config/redis.js";

const IMAP_QUEUE_NAME = "imapQueue";
const SCHEDULER_ID = "imap-scheduler";
const CRON_PATTERN = "*/10 * * * *";

const imapQueue = new Queue(IMAP_QUEUE_NAME, {
  connection: redisConnection,
});

export async function initializeImapScheduler(): Promise<void> {
  console.log("[STARTUP] Initializing IMAP scheduler...");
  try {
    await imapQueue.upsertJobScheduler(SCHEDULER_ID, {
      pattern: CRON_PATTERN,
    });
    console.log(
      `[STARTUP] IMAP scheduler registered successfully (ID: '${SCHEDULER_ID}', Pattern: '${CRON_PATTERN}').`,
    );
  } catch (error: any) {
    console.error(
      `[STARTUP] Failed to register IMAP scheduler '${SCHEDULER_ID}':`,
      error.message || error,
    );
    throw error;
  }
}

export { imapQueue };
export default imapQueue;
