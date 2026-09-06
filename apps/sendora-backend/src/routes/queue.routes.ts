import { Hono } from "hono";
import { processSingleCampaignJob } from "../jobs/fetch-campaigns.js";

const queueRoutes = new Hono();

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
