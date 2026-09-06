import { DateTime } from "luxon";
import { prisma } from "../services/prisma.service.js";
import {
  enqueueEmailBatches,
  getEnqueuedEmailIds,
} from "../queues/batch-email.queue.js";

/**
 * Processes the campaign job by fetching campaigns and their emails,
 * filtering based on delivery time, credits, and send delay, then enqueues email batches.
 * @returns {Promise<Array>} List of processed email IDs or an empty array on error.
 */
async function processCampaignJob() {
  try {
    // Fetch all non-deleted campaigns with a user
    const campaigns = await prisma.campaign.findMany({
      where: {
        deleted: false,
        userId: { not: null },
      },
      include: { user: true },
    });

    if (campaigns.length === 0) {
      console.log("No campaigns found.");
      return [];
    }

    // Filter campaigns based on delivery period and available credits
    const validCampaigns = campaigns.filter(passesDeliveryAndCreditCheck);

    // Extract campaign IDs from valid campaigns
    const campaignIds = validCampaigns.map((c: any) => c.id);
    if (campaignIds.length === 0) {
      console.log(
        "No valid campaigns found based on delivery time and credits.",
      );
      return [];
    }

    // Fetch all emails belonging to valid campaigns with RUNNING status,
    // where email status is PENDING or RUNNING (excluding REPLIED and BOUNCED)
    const campaignEmails = await prisma.campaignEmail.findMany({
      where: {
        campaignId: { in: campaignIds },
        campaign: { status: "RUNNING" },
        status: { in: ["PENDING", "RUNNING"] },
        NOT: [{ status: "REPLIED" }, { status: "BOUNCED" }],
      },
      include: { campaign: { include: { pitches: true } } },
      orderBy: { stage: "asc" },
    });

    // Filter emails based on the send delay (if any)
    // Stage 0 (fresh leads) should always be sent immediately, regardless of sent_at.
    // For follow-ups, use the per-stage delay from the matching pitch, falling back
    // to the campaign-wide daysInterval when a pitch has no explicit delay.
    const validEmails = campaignEmails.filter((email: any) => {
      if (email.stage === 0) return true;

      const stagePitch = email.campaign?.pitches?.find(
        (p: any) => p.stage === email.stage,
      );
      const delay = stagePitch?.delayDays ?? email.campaign?.daysInterval ?? 0;

      return shouldSendToday(email.sentAt?.toISOString() ?? null, delay);
    });

    let emailIds = validEmails.map((email: any) => email.id);
    if (emailIds.length === 0) {
      console.log("No valid emails to process.");
      return [];
    }

    // Fetch enqueued email IDs
    const alreadyEnqueuedIds = await getEnqueuedEmailIds();
    emailIds = emailIds.filter((id: any) => !alreadyEnqueuedIds.has(id));

    if (emailIds.length === 0) {
      console.log("No new emails to enqueue (all are already queued).");
      return [];
    }

    console.log("Enqueuing email IDs:", emailIds);
    await enqueueEmailBatches(emailIds);

    return emailIds;
  } catch (error) {
    console.error("Error processing campaign job:", error);
    return [];
  }
}

/**
 * Checks if a campaign is active on the current day based on active_days array.
 * @param {Object} campaign - Campaign object with active_days array.
 * @param {DateTime} currentTime - Current time in the campaign's timezone.
 * @returns {boolean} True if the campaign is active today, false otherwise.
 */
function isCampaignActiveToday(campaign: any, currentTime: DateTime) {
  // If no activeDays specified, assume the campaign is always active
  const activeDays = campaign.activeDays;
  if (!activeDays || !Array.isArray(activeDays) || activeDays.length === 0) {
    return true;
  }

  // Get the current day name in lowercase
  // Luxon weekday: 1=Monday, 2=Tuesday, ..., 7=Sunday
  const dayNames = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  const currentDayName = dayNames[currentTime.weekday - 1]; // Convert to 0-based index

  // Check if the current day is in the activeDays array (case-insensitive)
  const activeDaysLowercase = activeDays.map((day: string) =>
    day.toLowerCase(),
  );
  return activeDaysLowercase.includes(currentDayName);
}

/**
 * Checks if a campaign passes the delivery time and credit requirements.
 * @param {Object} campaign - Campaign object.
 * @returns {boolean} True if the campaign meets the criteria, false otherwise.
 */
function passesDeliveryAndCreditCheck(campaign: any) {
  try {
    if (
      !campaign ||
      !campaign.user?.timezone ||
      !campaign.emailDeliveryPeriod
    ) {
      return false;
    }

    // Use Luxon to get the current time in the campaign's timezone
    const currentTime = DateTime.now().setZone(campaign.user.timezone);
    const withinPeriod = isWithinDeliveryPeriod(
      currentTime,
      campaign.emailDeliveryPeriod,
    );

    // Check if the campaign's associated user has available credits.
    const availableCredits = (campaign.user?.credits ?? 0) > 0;

    // Check if today is an active day for the campaign
    const isActiveDay = isCampaignActiveToday(campaign, currentTime);

    return withinPeriod && availableCredits && isActiveDay;
  } catch (error) {
    console.error(`Error checking campaign ${campaign?.id}:`, error);
    return false;
  }
}

/**
 * Determines whether the current time falls within the specified delivery period.
 * @param {DateTime} currentTime - The current time as a Luxon DateTime.
 * @param {string} deliveryPeriod - Delivery period name (e.g., "MORNING", "EVENING").
 * @returns {boolean} True if within the period, false otherwise.
 */
function isWithinDeliveryPeriod(currentTime: DateTime, deliveryPeriod: string) {
  // Ensure deliveryPeriod is a string; if not, log and return false.
  if (typeof deliveryPeriod !== "string") {
    console.warn(`Invalid delivery period: ${deliveryPeriod}`);
    return false;
  }

  const periods: Record<string, { start: number; end: number }> = {
    MORNING: { start: 6, end: 12 }, // 6 AM - 12 PM
    EVENING: { start: 12, end: 18 }, // 12 PM - 6 PM
    NIGHT: { start: 18, end: 24 }, // 6 PM - 12 AM
    MIDNIGHT: { start: 0, end: 6 }, // 12 AM - 6 AM
  };

  const periodKey = deliveryPeriod.toUpperCase();
  const period = periods[periodKey];

  if (!period) {
    console.warn(`Unrecognized delivery period: ${deliveryPeriod}`);
    return false;
  }

  const currentHour = currentTime.hour;
  return currentHour >= period.start && currentHour < period.end;
}

/**
 * Determines if an email should be sent today based on its last sent date and delay.
 * @param {string|null} sentAt - ISO date string of when the email was last sent.
 * @param {number} delay - Minimum number of days between sends.
 * @returns {boolean} True if the email should be sent, false otherwise.
 */
function shouldSendToday(sentAt: string | null, delay: number) {
  // If no sent date is available, send immediately.
  if (!sentAt) return true;
  try {
    return daysPassed(sentAt) >= delay;
  } catch (error) {
    console.error("Error determining if email should be sent today:", error);
    return false;
  }
}

/**
 * Calculates the number of days that have passed since the given ISO date.
 * @param {string} isoDateString - ISO formatted date string.
 * @returns {number} Number of full days passed.
 * @throws Will throw an error if the date format is invalid.
 */
function daysPassed(isoDateString: string) {
  const pastDate = new Date(isoDateString);
  if (isNaN(pastDate.getTime())) {
    throw new Error(`Invalid date format: ${isoDateString}`);
  }

  // Count full elapsed 24h periods from the actual send instant.
  //
  // We deliberately do NOT normalize to midnight. The old code did
  // `setHours(0,0,0,0)` on both dates, which (a) counted calendar-date
  // crossings rather than elapsed time — so a follow-up could fire up to a
  // day early when the send happened late in the day — and (b) used the
  // server's LOCAL timezone to pick midnight, while `sentAt` is stored in
  // UTC, drifting the day boundary by the server's offset (e.g. a Europe
  // Hetzner box firing follow-ups a day early). Working directly on the two
  // absolute instants is timezone-independent and never fires early.
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((Date.now() - pastDate.getTime()) / msPerDay);
}

/**
 * Processes a single campaign for test / manual triggering.
 * Validates ownership, status, SMTP credentials, timezone, delivery window,
 * user credits, and active days before enqueuing pending emails.
 */
async function processSingleCampaignJob(
  campaignId: string,
  userId?: string,
) {
  console.log(`[TEST TRIGGER] Campaign triggered for campaignId: ${campaignId}`);

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId, deleted: false },
      include: {
        user: true,
        campaignEmailCredentials: { include: { emailCredential: true } },
        pitches: true,
      },
    });

    if (!campaign) {
      return {
        success: false,
        reason: "Campaign not found",
        details: "No active campaign exists with this ID.",
      };
    }

    if (userId && campaign.userId !== userId) {
      return {
        success: false,
        reason: "Unauthorized",
        details: "Campaign does not belong to the authenticated user.",
      };
    }

    if (campaign.status !== "RUNNING") {
      return {
        success: false,
        reason: "Campaign not RUNNING",
        details: `Campaign status is currently '${campaign.status}'. Please start the campaign first.`,
      };
    }

    const creds = campaign.campaignEmailCredentials;
    if (!creds || !Array.isArray(creds) || creds.length === 0) {
      return {
        success: false,
        reason: "Missing SMTP credential",
        details: "No email accounts / SMTP credentials are configured for this campaign.",
      };
    }

    if (!campaign.user?.timezone) {
      return {
        success: false,
        reason: "Missing timezone",
        details: "User profile timezone is not set. Please set timezone in Account Settings.",
      };
    }

    if (!campaign.emailDeliveryPeriod) {
      return {
        success: false,
        reason: "Missing delivery period",
        details: "Campaign delivery period is not configured.",
      };
    }

    const currentTime = DateTime.now().setZone(campaign.user.timezone);
    const withinPeriod = isWithinDeliveryPeriod(
      currentTime,
      campaign.emailDeliveryPeriod,
    );
    if (!withinPeriod) {
      return {
        success: false,
        reason: "Outside delivery window",
        details: `Current time in user timezone (${currentTime.toFormat(
          "HH:mm",
        )}) is outside delivery period '${campaign.emailDeliveryPeriod}'.`,
      };
    }

    const availableCredits = (campaign.user?.credits ?? 0) > 0;
    if (!availableCredits) {
      return {
        success: false,
        reason: "No credits",
        details: `User has insufficient credits (${campaign.user?.credits ?? 0}).`,
      };
    }

    const isActiveDay = isCampaignActiveToday(campaign, currentTime);
    if (!isActiveDay) {
      return {
        success: false,
        reason: "No active day",
        details: `Today (${currentTime.weekdayLong}) is not an active day for this campaign.`,
      };
    }

    const campaignEmails = await prisma.campaignEmail.findMany({
      where: {
        campaignId: campaignId,
        status: { in: ["PENDING", "RUNNING"] },
        NOT: [{ status: "REPLIED" }, { status: "BOUNCED" }],
      },
      include: { campaign: { include: { pitches: true } } },
      orderBy: { stage: "asc" },
    });

    if (campaignEmails.length === 0) {
      return {
        success: false,
        reason: "No pending emails",
        details: "There are no pending or running emails in this campaign.",
      };
    }

    const validEmails = campaignEmails.filter((email: any) => {
      if (email.stage === 0) return true;

      const stagePitch = email.campaign?.pitches?.find(
        (p: any) => p.stage === email.stage,
      );
      const delay = stagePitch?.delayDays ?? email.campaign?.daysInterval ?? 0;

      return shouldSendToday(email.sentAt?.toISOString() ?? null, delay);
    });

    let emailIds = validEmails.map((email: any) => email.id);
    if (emailIds.length === 0) {
      return {
        success: false,
        reason: "Send delay constraint",
        details: "Pending emails for follow-up stages are waiting for their send delay interval.",
      };
    }

    const alreadyEnqueuedIds = await getEnqueuedEmailIds();
    emailIds = emailIds.filter((id: any) => !alreadyEnqueuedIds.has(id));

    if (emailIds.length === 0) {
      return {
        success: false,
        reason: "Already enqueued",
        details: "All eligible emails for this campaign are already queued in Redis.",
      };
    }

    console.log(`[TEST TRIGGER] Eligible emails found: ${emailIds.length}`);
    console.log(`[TEST TRIGGER] Batch queued for ${emailIds.length} emails`);

    await enqueueEmailBatches(emailIds);

    return {
      success: true,
      enqueuedCount: emailIds.length,
      emailIds,
      details: `Successfully queued ${emailIds.length} email(s) for test processing.`,
    };
  } catch (error: any) {
    console.error(`[TEST TRIGGER] Error processing single campaign ${campaignId}:`, error);
    return {
      success: false,
      reason: "Execution error",
      details: error.message || "Failed to process campaign job.",
    };
  }
}
export { processCampaignJob, processSingleCampaignJob };
