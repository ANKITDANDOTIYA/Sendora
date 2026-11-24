import { Hono } from "hono";
import { processSingleCampaignJob } from "../jobs/fetch-campaigns.js";
import {
  campaignQueue,
  initializeCampaignScheduler,
} from "../queues/campaign.queue.js";
import { sendSingleLeadImmediate } from "../services/email-service.js";
import { getLeadDeliveryDiagnostics } from "../services/lead-diagnostic.service.js";

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
    const { campaignId, userId, force } = await c.req.json();

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

    const result = await processSingleCampaignJob(campaignId, userId, {
      force: force !== false,
    });

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

// Immediate send to a single selected lead (for manual testing & debug)
queueRoutes.post("/send-lead", async (c) => {
  try {
    const { campaignId, leadId, userId, isTestOnly, relayUrl } = await c.req.json();

    if (!campaignId || !leadId) {
      return c.json(
        {
          success: false,
          reason: "Missing parameters",
          details: "Both campaignId and leadId are required.",
        },
        400,
      );
    }

    const result = await sendSingleLeadImmediate({
      campaignId,
      leadId,
      userId,
      isTestOnly: isTestOnly !== false, // Defaults to test-mode (does not prematurely complete lead)
      relayUrl,
    });

    if (result.success) {
      return c.json(result, 200);
    } else {
      return c.json(result, 422);
    }
  } catch (error: any) {
    console.error("Error in /send-lead route:", error);
    return c.json(
      {
        success: false,
        reason: "Server Error",
        details: error.message || "Failed to send email to lead.",
      },
      500,
    );
  }
});

// Lead delivery lifecycle & diagnostic visibility
queueRoutes.get("/lead-diagnostics/:leadId", async (c) => {
  try {
    const leadId = c.req.param("leadId");

    if (!leadId) {
      return c.json(
        {
          success: false,
          reason: "Missing parameter",
          details: "leadId parameter is required.",
        },
        400,
      );
    }

    const diagnostics = await getLeadDeliveryDiagnostics(leadId);

    if (!diagnostics) {
      return c.json(
        {
          success: false,
          reason: "Lead not found",
          details: `No lead was found with ID '${leadId}'.`,
        },
        404,
      );
    }

    return c.json({ success: true, diagnostics }, 200);
  } catch (error: any) {
    console.error("Error in /lead-diagnostics route:", error);
    return c.json(
      {
        success: false,
        reason: "Server Error",
        details: error.message || "Failed to fetch lead diagnostics.",
      },
      500,
    );
  }
});

export { queueRoutes };
