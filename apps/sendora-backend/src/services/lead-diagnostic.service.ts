import { DateTime } from "luxon";
import { prisma } from "./prisma.service.js";
import { getEnqueuedEmailIds } from "../queues/batch-email.queue.js";
import {
  isCampaignActiveToday,
  isWithinDeliveryPeriod,
  shouldSendToday,
} from "../jobs/fetch-campaigns.js";
import { getCredentialSentCount } from "./credential-service.js";
import { redisConnection } from "../config/redis.js";

export interface DiagnosticEvent {
  timestamp: string;
  stage: string;
  event: string;
  details: Record<string, any>;
  status: "SUCCESS" | "FAILED" | "PENDING" | "INFO";
}

export interface LeadDiagnostics {
  lead: {
    id: string;
    email: string;
    name: string | null;
    status: string;
    stage: number;
    sentAt: string | null;
    opened: number;
    created: string;
    updated: string;
    credId: string | null;
    credEmail: string | null;
    isReplied: boolean;
    canSend: boolean;
  };
  campaign: {
    id: string;
    title: string | null;
    status: string | null;
    maxStageCount: number;
    emailDeliveryPeriod: string;
    activeDays: string[];
    userCredits: number;
    userTimezone: string;
    configuredCredentialsCount: number;
  };
  schedulerEligibility: {
    isEligible: boolean;
    skipReason: string | null;
    checks: {
      campaignStatusOk: boolean;
      userCreditsOk: boolean;
      activeDayOk: boolean;
      deliveryWindowOk: boolean;
      smtpCredentialsOk: boolean;
      followUpDelayOk: boolean;
      alreadyEnqueued: boolean;
      notReplied: boolean;
      noConcurrentSend: boolean;
    };
    currentServerTimeUtc: string;
    currentTimeInUserTz: string;
  };
  concurrency: {
    isLocked: boolean;
  };
  queueStatus: {
    isEnqueued: boolean;
    queueName: string;
  };
  smtpCredential: {
    id: string | null;
    email: string | null;
    host: string | null;
    port: number | null;
    secure: boolean | null;
    dailyLimit: number;
    sentToday: number;
  } | null;
  messages: Array<{
    id: string;
    messageId: string | null;
    sent: boolean;
    timestamp: string | null;
    pitchTitle: string | null;
  }>;
  history: DiagnosticEvent[];
}

/**
 * Compiles end-to-end delivery diagnostics for a single lead,
 * evaluating scheduler eligibility, queue state, SMTP credentials, and message history.
 */
export async function getLeadDeliveryDiagnostics(
  leadId: string,
): Promise<LeadDiagnostics | null> {
  const lead = await prisma.campaignEmail.findUnique({
    where: { id: leadId },
    include: {
      campaign: {
        include: {
          user: true,
          pitches: true,
          campaignEmailCredentials: {
            include: { emailCredential: true },
          },
        },
      },
      cred: true,
      campaignMessages: {
        include: { pitch: true },
        orderBy: { created: "desc" },
      },
      campaignOpens: {
        orderBy: { created: "desc" },
      },
    },
  });

  if (!lead) return null;

  const campaign = lead.campaign;
  const user = campaign?.user;
  const userTimezone = user?.timezone || "UTC";
  const deliveryPeriod = campaign?.emailDeliveryPeriod || "ALL_DAY";

  const currentUtc = DateTime.now().toUTC();
  const currentTimeInUserTz = DateTime.now().setZone(userTimezone);

  // 1. Scheduler Eligibility Checks
  const campaignStatusOk =
    campaign?.status === "RUNNING" || campaign?.status === "PENDING";
  const userCredits = user?.credits ?? 0;
  const userCreditsOk = userCredits > 0;
  const activeDayOk = campaign
    ? isCampaignActiveToday(campaign, currentTimeInUserTz)
    : false;
  const deliveryWindowOk = isWithinDeliveryPeriod(
    currentTimeInUserTz,
    deliveryPeriod,
  );

  const campaignCreds = (campaign?.campaignEmailCredentials ?? [])
    .map((cec: any) => cec.emailCredential)
    .filter(Boolean);
  const smtpCredentialsOk = campaignCreds.length > 0;

  let followUpDelayOk = true;
  let delayDaysNeeded = 0;
  let daysSinceLastSent = 0;
  if ((lead.stage || 0) > 0 && lead.sentAt) {
    const pitch = campaign?.pitches?.find((p: any) => p.stage === lead.stage);
    delayDaysNeeded = pitch?.delayDays ?? campaign?.daysInterval ?? 0;
    followUpDelayOk = shouldSendToday(lead.sentAt.toISOString(), delayDaysNeeded);
    const msPassed = Date.now() - new Date(lead.sentAt).getTime();
    daysSinceLastSent = Math.floor(msPassed / (1000 * 60 * 60 * 24));
  }

  // Check if lead received an incoming reply
  const hasIncomingReply = lead.campaignMessages?.some((m: any) => m.sent === false);
  const isReplied = lead.status === "REPLIED" || Boolean(hasIncomingReply);
  if (isReplied && lead.status !== "REPLIED") {
    try {
      await prisma.campaignEmail.update({
        where: { id: lead.id },
        data: { status: "REPLIED" },
      });
      lead.status = "REPLIED";
    } catch {}
  }

  // Check Redis concurrency lock for active send
  let isSendingNow = false;
  try {
    if (redisConnection && typeof (redisConnection as any).get === "function") {
      const lockHolder = await (redisConnection as any).get(`lock:lead:send:${lead.id}`);
      isSendingNow = Boolean(lockHolder);
    }
  } catch {}

  // Check Redis Queue status
  let alreadyEnqueued = false;
  try {
    const enqueuedSet = await getEnqueuedEmailIds();
    alreadyEnqueued = enqueuedSet.has(lead.id);
  } catch {}

  const canSendStatus = !["COMPLETED", "FAILED", "BOUNCED", "REPLIED", "UNSUBSCRIBED"].includes(lead.status || "");
  const isEligible =
    campaignStatusOk &&
    userCreditsOk &&
    activeDayOk &&
    deliveryWindowOk &&
    smtpCredentialsOk &&
    followUpDelayOk &&
    !alreadyEnqueued &&
    !isSendingNow &&
    !isReplied &&
    canSendStatus;

  let skipReason: string | null = null;
  if (!isEligible) {
    if (isReplied) {
      skipReason = "Lead has already replied to this campaign. Sending is permanently stopped.";
    } else if (isSendingNow) {
      skipReason = "An email dispatch is currently in progress for this lead (concurrency lock active).";
    } else if (!campaignStatusOk) {
      skipReason = `Campaign status is '${campaign?.status || "UNKNOWN"}'. Must be RUNNING or PENDING.`;
    } else if (!smtpCredentialsOk) {
      skipReason = "No SMTP credentials configured for this campaign.";
    } else if (!userCreditsOk) {
      skipReason = `User credits depleted (${userCredits} remaining).`;
    } else if (!activeDayOk) {
      skipReason = `Today (${currentTimeInUserTz.weekdayLong}) is not an active campaign sending day.`;
    } else if (!deliveryWindowOk) {
      skipReason = `Outside configured delivery window '${deliveryPeriod}' (current hour in ${userTimezone}: ${currentTimeInUserTz.toFormat("HH:mm")}).`;
    } else if (!followUpDelayOk) {
      skipReason = `Waiting for stage ${lead.stage} delay interval (${delayDaysNeeded} days required, ${daysSinceLastSent} days elapsed).`;
    } else if (alreadyEnqueued) {
      skipReason = "Already queued in Redis waiting for batch execution.";
    } else if (["COMPLETED", "FAILED", "BOUNCED"].includes(lead.status || "")) {
      skipReason = `Lead is in terminal state '${lead.status}'.`;
    }
  }

  // 2. SMTP Credential Diagnostics
  let credentialDetails: LeadDiagnostics["smtpCredential"] = null;
  const activeCred = lead.cred || campaignCreds[0];
  if (activeCred) {
    let sentToday = 0;
    try {
      sentToday = await getCredentialSentCount(activeCred.id);
    } catch {}

    credentialDetails = {
      id: activeCred.id,
      email: activeCred.username || null,
      host: activeCred.host || null,
      port: activeCred.port || null,
      secure: activeCred.secure ?? null,
      dailyLimit: activeCred.dailyLimit || 50,
      sentToday,
    };
  }

  // 3. Build Chronological History
  const history: DiagnosticEvent[] = [];

  // Event: Lead Created
  history.push({
    timestamp: lead.created.toISOString(),
    stage: "Stage 0",
    event: "Lead Added to Campaign",
    details: {
      email: lead.email,
      name: lead.name,
      campaignTitle: campaign?.title,
    },
    status: "INFO",
  });

  // Event: Credential Assigned
  if (lead.cred) {
    history.push({
      timestamp: lead.updated.toISOString(),
      stage: `Stage ${lead.stage || 0}`,
      event: "SMTP Mailbox Assigned",
      details: {
        mailbox: lead.cred.username,
        host: lead.cred.host,
        port: lead.cred.port,
      },
      status: "INFO",
    });
  }

  // Event: Messages Sent / Incoming Replies
  (lead.campaignMessages || []).forEach((msg: any) => {
    const isReply = msg.sent === false;
    history.push({
      timestamp: (msg.timestamp || msg.created).toISOString(),
      stage: isReply ? "Reply Received" : msg.pitch ? `Stage ${msg.pitch.stage}` : `Stage ${lead.stage}`,
      event: isReply ? "Lead Replied to Campaign" : "SMTP Email Dispatched",
      details: {
        messageId: msg.messageId,
        pitchTitle: msg.pitch?.title || (isReply ? "Incoming Reply" : "Follow-up"),
        subject: msg.pitch?.subject || "",
        snippet: msg.text ? msg.text.substring(0, 100) : null,
      },
      status: isReply ? "INFO" : "SUCCESS",
    });
  });

  // Event: Opens
  (lead.campaignOpens || []).forEach((open: any) => {
    history.push({
      timestamp: open.created.toISOString(),
      stage: `Stage ${lead.stage || 0}`,
      event: "Recipient Opened Email",
      details: {
        openId: open.id,
      },
      status: "SUCCESS",
    });
  });

  // Sort history chronologically
  history.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return {
    lead: {
      id: lead.id,
      email: lead.email || "",
      name: lead.name,
      status: lead.status || "PENDING",
      stage: lead.stage || 0,
      sentAt: lead.sentAt ? lead.sentAt.toISOString() : null,
      opened: lead.opened || 0,
      created: lead.created.toISOString(),
      updated: lead.updated.toISOString(),
      credId: lead.credId,
      credEmail: lead.cred?.username || null,
      isReplied,
      canSend: !isReplied && canSendStatus,
    },
    campaign: {
      id: campaign?.id || "",
      title: campaign?.title || null,
      status: campaign?.status || null,
      maxStageCount: campaign?.maxStageCount || 1,
      emailDeliveryPeriod: deliveryPeriod,
      activeDays: (campaign?.activeDays as string[]) || [],
      userCredits,
      userTimezone,
      configuredCredentialsCount: campaignCreds.length,
    },
    schedulerEligibility: {
      isEligible,
      skipReason,
      checks: {
        campaignStatusOk,
        userCreditsOk,
        activeDayOk,
        deliveryWindowOk,
        smtpCredentialsOk,
        followUpDelayOk,
        alreadyEnqueued,
        notReplied: !isReplied,
        noConcurrentSend: !isSendingNow,
      },
      currentServerTimeUtc: currentUtc.toISO() || "",
      currentTimeInUserTz: currentTimeInUserTz.toISO() || "",
    },
    concurrency: {
      isLocked: isSendingNow,
    },
    queueStatus: {
      isEnqueued: alreadyEnqueued,
      queueName: "batchEmailQueue",
    },
    smtpCredential: credentialDetails,
    messages: (lead.campaignMessages || []).map((m: any) => ({
      id: m.id,
      messageId: m.messageId,
      sent: m.sent,
      timestamp: m.timestamp ? m.timestamp.toISOString() : null,
      pitchTitle: m.pitch?.title || null,
    })),
    history,
  };
}
