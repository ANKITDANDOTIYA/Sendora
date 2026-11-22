import { Hono } from "hono";
import { processSingleCampaignJob } from "../jobs/fetch-campaigns.js";
import {
  campaignQueue,
  initializeCampaignScheduler,
} from "../queues/campaign.queue.js";

const queueRoutes = new Hono();

// Diagnostic endpoint to inspect active BullMQ schedulers in Redis
queueRoutes.get("/schedulers", async (c) => {
  try {
    const schedulers = await campaignQueue.getJobSchedulers();
    return c.json(
      {
        success: true,
        queue: "campaignQueue",
        schedulerCount: schedulers.length,
        schedulers,
      },
      200,
    );
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: error.message || "Failed to inspect schedulers.",
      },
      500,
    );
  }
});

// Manual trigger / re-initialization endpoint if Redis was offline during startup
queueRoutes.post("/init-schedulers", async (c) => {
  try {
    await initializeCampaignScheduler();
    const schedulers = await campaignQueue.getJobSchedulers();
    return c.json(
      {
        success: true,
        message: "Campaign scheduler initialized successfully.",
        schedulers,
      },
      200,
    );
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: error.message || "Failed to initialize scheduler.",
      },
      500,
    );
  }
});

queueRoutes.post("/trigger-campaign", async (c) => {
  try {
    const { campaignId, userId } = await c.req.json();

    if (!campaignId) {
      return c.json(
        {
          success: false,
          reason: "Missing parameters",
          details: "campaignId is required.",
        },
        400,
      );
    }

    const result = await processSingleCampaignJob(campaignId, userId);

    if (result.success) {
      return c.json(result, 200);
    } else {
      return c.json(result, 422);
    }
  } catch (error: any) {
    console.error("Error in /trigger-campaign route:", error);
    return c.json(
      {
        success: false,
        reason: "Server Error",
        details: error.message || "Failed to trigger campaign.",
      },
      500,
    );
  }
});

export { queueRoutes };
