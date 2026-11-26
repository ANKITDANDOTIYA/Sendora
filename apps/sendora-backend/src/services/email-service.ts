/**
 * Email service for sending campaign emails
 */

import { v4 as uuidv4 } from "uuid";
import { prisma } from "./prisma.service.js";
import { log } from "../utils/logger.js";
import {
  isValidEmail,
  applyHoganPersonalization,
  normalizeEmailBody,
} from "../utils/helpers.js";
import {
  getEmailTransporter,
  removeTransporter,
  setupEmailTransporters,
  sendMailWithFallback,
} from "../utils/credential-service.js";
import {
  fetchPitch,
  updateEmailStatus,
  createCampaignMessage,
} from "./campaign-service.js";
import type { SendMailOptions } from "nodemailer";
import type {
  EmailRecord,
  CredentialRecord,
  CampaignEmailCredential,
} from "../models/email.js";
import { getCredentialSentCount } from "./credential-service.js";
import { htmlToText } from "html-to-text";
import { redisConnection } from "../config/redis.js";

/**
 * Concurrency lock helper: acquires an atomic Redis lock for a given lead ID.
 * Returns true if the lock was acquired, false if another send is in progress.
 */
async function acquireLeadSendLock(leadId: string, txId: string): Promise<boolean> {
  try {
    if (redisConnection && typeof (redisConnection as any).set === "function") {
      // If redis is not connected or in wait state (e.g. during offline test execution), bypass lock
      if ((redisConnection as any).status !== "ready") {
        return true;
      }
      const res = await (redisConnection as any).set(`lock:lead:send:${leadId}`, txId, "EX", 60, "NX");
      return res === "OK";
    }
  } catch (err: any) {
    log("WARN", `Could not acquire Redis lock for lead ${leadId}: ${err.message}`, txId);
  }
  return true; // Fallback if Redis is mocked or temporarily unavailable
}

/**
 * Concurrency lock helper: safely releases the Redis lock for a lead ID if held by txId.
 */
async function releaseLeadSendLock(leadId: string, txId: string): Promise<void> {
  try {
    if (redisConnection && typeof (redisConnection as any).get === "function") {
      if ((redisConnection as any).status !== "ready") {
        return;
      }
      const lockKey = `lock:lead:send:${leadId}`;
      const holder = await (redisConnection as any).get(lockKey);
      if (holder === txId) {
        await (redisConnection as any).del(lockKey);
      }
    }
  } catch (err: any) {
    log("WARN", `Could not release Redis lock for lead ${leadId}: ${err.message}`, txId);
  }
}

/**
 * Fetches threading information for an email
 * @param emailId - ID of the email
 * @param txId - Transaction ID for logging
 * @returns Threading information or null if not found
 */
async function getThreadingInfo(
  emailId: string,
  txId: string,
): Promise<{ replyTo: string; references: string[] } | null> {
  try {
    // Query campaign messages for threading information
    const threadInfo = await prisma.campaignMessage.findFirst({
      where: { campaignEmailId: emailId },
      orderBy: { created: "desc" },
    });

    if (!threadInfo) {
      log("INFO", `No threading information found for email ${emailId}`, txId);
      return null;
    }

    // Extract reply_to and build references from previous messages
    const replyTo = threadInfo.messageId;
    const allMessages = await prisma.campaignMessage.findMany({
      where: { campaignEmailId: emailId },
      orderBy: { created: "asc" },
      select: { messageId: true },
    });
    const references = allMessages
      .map((m: { messageId: string | null }) => m.messageId)
      .filter((id: string | null): id is string => !!id);

    log("INFO", `Found threading information for email ${emailId}`, txId, {
      replyTo: replyTo || "none",
      referenceCount: references.length,
    });

    return {
      replyTo,
      references,
    };
  } catch (error: any) {
    // If the record doesn't exist or there's an error, return null
    log(
      "WARN",
      `Error fetching threading information for email ${emailId}`,
      txId,
      {
        error: error.message,
      },
    );
    return null;
  }
}

/**
 * Determines whether an error while sending is a transient / retryable error
 * (connection timeout, socket timeout, connection reset, temporary rate limit, etc.)
 */
export function isTransientError(error: any): boolean {
  if (!error) return false;

  const message = String(error.message || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();
  const responseCode = Number(error.responseCode) || 0;
  const response = String(error.response || "").toLowerCase();

  // Connection timeout / socket / network errors
  if (
    message.includes("connection timeout") ||
    message.includes("greeting timeout") ||
    message.includes("socket timeout") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND"
  ) {
    return true;
  }

  // Rate limiting / too many login attempts
  if (
    (code === "EAUTH" && (responseCode === 454 || responseCode === 421)) ||
    message.includes("too many login attempts") ||
    message.includes("rate limit") ||
    response.includes("too many login attempts") ||
    response.includes("rate limit")
  ) {
    return true;
  }

  // 4xx temporary SMTP failures
  if (responseCode >= 400 && responseCode < 500) {
    return true;
  }

  return false;
}

export interface DeliveryLifecycleLog {
  campaignId?: string | null;
  campaignEmailId: string;
  recipientEmail: string;
  credentialId?: string | null;
  attemptNumber?: number;
  smtpResponseCode?: number | string | null;
  smtpMessageId?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  timestamp?: string;
  finalDatabaseStatus?: string | null;
  phase:
    | "QUEUED"
    | "PROCESSING"
    | "SMTP_ATTEMPT"
    | "SMTP_ACCEPTED"
    | "BOUNCE_DETECTED"
    | "REPLY_DETECTED"
    | "FAILED";
}

/**
 * Standardized delivery lifecycle logging with full operational context.
 */
export function logDeliveryLifecycle(data: DeliveryLifecycleLog): void {
  const timestamp = data.timestamp || new Date().toISOString();
  const payload = {
    ...data,
    timestamp,
  };

  log(
    data.phase === "FAILED" ? "ERROR" : "INFO",
    `[DELIVERY_LIFECYCLE] [${data.phase}] Lead ${data.campaignEmailId} -> ${data.recipientEmail}`,
    "",
    payload,
  );
}

/**
 * Resolves the public base URL for open-tracking pixel links.
 * Prefers configured BACKEND_URL, then Render-provided environment variables,
 * falling back to local port (never a dead external domain).
 */
export function getTrackingBaseUrl(): string | null {
  if (
    process.env.BACKEND_URL &&
    process.env.BACKEND_URL.trim() !== "" &&
    !process.env.BACKEND_URL.includes("localhost") &&
    !process.env.BACKEND_URL.includes("127.0.0.1")
  ) {
    return process.env.BACKEND_URL.trim().replace(/\/$/, "");
  }
  if (process.env.RENDER_EXTERNAL_URL && process.env.RENDER_EXTERNAL_URL.trim() !== "") {
    return process.env.RENDER_EXTERNAL_URL.trim().replace(/\/$/, "");
  }
  if (process.env.RENDER_EXTERNAL_HOSTNAME && process.env.RENDER_EXTERNAL_HOSTNAME.trim() !== "") {
    return `https://${process.env.RENDER_EXTERNAL_HOSTNAME.trim()}`.replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "production") {
    // In production, never inject localhost tracking URLs into recipient mailboxes (causes spam flagging)
    return null;
  }
  const port = process.env.PORT || 8100;
  return `http://localhost:${port}`;
}

/**
 * Sends an individual campaign email.
 * @param email - Email object from campaign.
 * @param txId - Transaction ID for logging
 * @returns boolean indicating whether email was sent successfully
 */
export async function sendCampaignEmail(
  email: EmailRecord,
  txId = uuidv4().substring(0, 8),
): Promise<boolean> {
  const startTime = Date.now();

  // Mask email for logging
  const maskedEmail = email.email
    ? email.email.substring(0, 3) + "***@" + email.email.split("@")[1]
    : null;

  log("INFO", `Starting to send campaign email`, txId, {
    emailId: email.id,
    campaign: email.campaign,
    stage: email.stage,
    to: maskedEmail,
  });

  // Strict rule: if lead is REPLIED, BOUNCED, or UNSUBSCRIBED, abort immediately.
  if (email.status === "REPLIED" || email.status === "BOUNCED" || email.status === "UNSUBSCRIBED") {
    log("WARN", `Skipping send for email ${email.id}: status is ${email.status}`, txId);
    return false;
  }

  // Check if an incoming reply exists in messages
  if ((email as any).campaignMessages?.some((m: any) => m.sent === false)) {
    log("WARN", `Skipping send for email ${email.id}: lead has already replied`, txId);
    if (email.status !== "REPLIED") {
      await prisma.campaignEmail.update({
        where: { id: email.id },
        data: { status: "REPLIED" },
      });
    }
    return false;
  }

  // Concurrency lock to prevent duplicate sends across workers/threads
  const lockAcquired = await acquireLeadSendLock(email.id, txId);
  if (!lockAcquired) {
    log("WARN", `Skipping send for email ${email.id}: concurrent dispatch is in progress`, txId);
    return false;
  }

  try {
    // Validate recipient email address
    if (!email.email || !isValidEmail(email.email)) {
      log("ERROR", `Invalid or missing recipient email address`, txId, {
        emailId: email.id,
        to: email.email,
      });

      await prisma.campaignEmail.update({
        where: { id: email.id },
        data: { status: "FAILED" },
      });
      return false;
    }

    log(
      "INFO",
      `Fetching pitch for campaign ${email.campaign} stage ${email.stage}`,
      txId,
    );
    const pitch = await fetchPitch(email);

    if (!pitch) {
      log(
        "WARN",
        `No pitch found for campaign ${email.campaign} at stage ${email.stage}`,
        txId,
      );
      await prisma.campaignEmail.update({
        where: { id: email.id },
        data: { status: "FAILED" },
      });
      return false;
    }

    log("INFO", `Pitch found: ${pitch.id}`, txId);

    // Retrieve the list of available email credentials from the campaign
    const campaignCreds: CampaignEmailCredential[] | undefined = (email as any)
      .campaign?.campaignEmailCredentials;
    const allCreds: CredentialRecord[] =
      campaignCreds
        ?.map((cec: CampaignEmailCredential) => cec.emailCredential)
        .filter((cred: CredentialRecord): cred is CredentialRecord =>
          Boolean(cred),
        ) ?? [];
    if (!allCreds || !allCreds.length) {
      log("ERROR", `No email credentials available for campaign`, txId, {
        campaignId: email.campaign,
      });

      await prisma.campaignEmail.update({
        where: { id: email.id },
        data: { status: "FAILED" },
      });
      return false;
    }

    log("INFO", `Found ${allCreds.length} credentials for campaign`, txId);

    let credential: CredentialRecord | undefined;
    if (email.stage === 0) {
      // For the first email, choose a random credential that hasn't reached its daily limit
      const availableCreds: CredentialRecord[] = [];

      for (const cred of allCreds) {
        const sentCount = await getCredentialSentCount(cred.id);
        if (sentCount < (cred.dailyLimit || 20)) {
          availableCreds.push(cred);
        }
      }

      if (availableCreds.length === 0) {
        log("ERROR", `All email credentials have reached daily limit`, txId, {
          emailId: email.id,
          campaignId: email.campaign,
        });
        return false;
      }

      log("INFO", `Found ${availableCreds.length} available credentials`, txId);

      credential =
        availableCreds[Math.floor(Math.random() * availableCreds.length)];
      log("INFO", `Selected credential for initial email`, txId, {
        credentialId: credential.id,
        emailProvider: credential.host,
      });

      // Save the chosen credential's id in the campaigns_email record for follow-ups
      log("INFO", `Saving selected credential to email record`, txId);
      await prisma.campaignEmail.update({
        where: { id: email.id },
        data: { credId: credential.id },
      });
    } else {
      // For follow-up emails (stage > 0), use the previously saved credential
      const savedCredentialId = email.credId;
      if (!savedCredentialId) {
        log(
          "ERROR",
          `No saved credential found in campaign email for stage > 0`,
          txId,
          {
            emailId: email.id,
          },
        );

        await prisma.campaignEmail.update({
          where: { id: email.id },
          data: { status: "FAILED" },
        });
        return false;
      }

      log(
        "INFO",
        `Using saved credential ${savedCredentialId} for follow-up email`,
        txId,
      );
      credential = allCreds.find(
        (cred: CredentialRecord) => cred.id === savedCredentialId,
      );

      if (!credential) {
        log("ERROR", `Saved credential not found in campaign emails`, txId, {
          emailId: email.id,
          credentialId: savedCredentialId,
        });

        await prisma.campaignEmail.update({
          where: { id: email.id },
          data: { status: "FAILED" },
        });
        return false;
      }

      // Check if credential has reached its daily limit
      const sentCount = await getCredentialSentCount(credential.id);
      if (sentCount >= (credential.dailyLimit || 30)) {
        log("ERROR", `Daily limit reached for credential`, txId, {
          credentialId: credential.id,
          emailId: email.id,
          sentCount,
          limit: credential.dailyLimit || 30,
        });
        return false;
      }
    }

    // Validate sender credentials
    if (!credential || !credential.username || !credential.password) {
      log("ERROR", `Invalid or incomplete credential`, txId, {
        emailId: email.id,
        credentialId: credential?.id,
      });

      await prisma.campaignEmail.update({
        where: { id: email.id },
        data: { status: "FAILED" },
      });
      return false;
    }

    // Get the transporter using the credential's id
    log(
      "INFO",
      `Getting email transporter for credential ${credential.id}`,
      txId,
    );
    let transporter = getEmailTransporter(credential.id);

    if (!transporter) {
      log(
        "INFO",
        `No transporter cached for credential ${credential.id}, setting up on-demand`,
        txId,
      );
      setupEmailTransporters([credential]);
      transporter = getEmailTransporter(credential.id);
    }

    if (!transporter) {
      log("ERROR", `No transporter found for credential`, txId, {
        credentialId: credential.id,
      });
      return false;
    }

    log("INFO", `Personalization`, txId, {
      personalizationData: email.personalization,
      type: typeof email.personalization,
      name: email.name,
      email: email.email,
    });

    const personalizationData = {
      name: email.name || "there",
      email: email.email, // Recipient's email address (stored in "email")
      ...(typeof email.personalization === "string"
        ? JSON.parse(email.personalization || "{}")
        : email.personalization || {}),
    };

    log("INFO", `Applying personalization to email template`, txId);
    const { subject, body: rawBody } = applyHoganPersonalization(
      pitch,
      personalizationData,
    );

    // Flatten legacy <p>-block markup to clean <br> spacing so sent mail matches
    // the hand-typed look, regardless of how the stored template was authored.
    const body = normalizeEmailBody(rawBody);

    log("INFO", `Personalization applied successfully`, txId, {
      subjectLength: subject.length,
      bodyLength: body.length,
    });

    // Check if tracking is enabled for this campaign
    const isTrackingEnabled = email.campaign?.isTrackingEnabled === true;
    log(
      "INFO",
      `Email tracking ${
        isTrackingEnabled ? "enabled" : "disabled"
      } for campaign`,
      txId,
      {
        campaignId: email.campaign,
      },
    );

    let processedBody = body;

    // Add tracking pixel only if tracking is enabled and a valid public base URL exists
    if (isTrackingEnabled) {
      const baseUrl = getTrackingBaseUrl();
      if (baseUrl) {
        const trackingUrl = `${baseUrl}/tracking/open?id=${email.id}`;
        const trackingPixel = `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;" />`;
        processedBody = body + trackingPixel;
      }
    }

    // Double-check recipient email before sending
    if (!email.email || !isValidEmail(email.email)) {
      log("ERROR", `Invalid recipient email address`, txId, {
        emailId: email.id,
        to: email.email,
      });

      await prisma.campaignEmail.update({
        where: { id: email.id },
        data: { status: "FAILED" },
      });
      return false;
    }

    // Set up mail options
    // Prefer a "Display Name <email>" From when the account owner has a name set,
    // so recipients see a human name instead of a bare address. Falls back to the
    // raw address. Uses campaign.user (already joined) — same account owns the creds.
    const senderName = email.campaign?.user?.name;
    const fromAddress = senderName
      ? `"${senderName}" <${credential.username}>`
      : credential.username;

    const mailOptions: SendMailOptions = {
      from: fromAddress, // Display-name From when available, else bare address
      to: email.email.trim(), // Trim to remove any whitespace
      subject,
      html: processedBody,
      text: htmlToText(processedBody, {
        wordwrap: 130,
        selectors: [
          { selector: "img", format: "skip" }, // ignore images
          { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
        ],
      }),
      // Add headers for tracking
      // headers: {
      //   "X-Transaction-ID": txId,
      //   "X-Campaign-ID": email.campaign,
      //   "X-Email-ID": email.id,
      // },
    };

    // For follow-up emails (stage > 0), set up threading headers
    if (email.stage > 0) {
      log(
        "INFO",
        `Setting up email threading for follow-up email (stage ${email.stage})`,
        txId,
      );

      // Get threading information from the view
      const threadingInfo = await getThreadingInfo(email.id, txId);

      if (threadingInfo && threadingInfo.replyTo) {
        log("INFO", `Adding threading headers`, txId, {
          inReplyTo: threadingInfo.replyTo,
          referenceCount: threadingInfo.references.length,
        });

        mailOptions.inReplyTo = threadingInfo.replyTo;
        mailOptions.references = threadingInfo.references;

        // Add "Re:" prefix to subject if not already present
        // if (!subject.startsWith("Re:")) {
        //   mailOptions.subject = `Re: ${subject}`;
        // }
      } else {
        log(
          "WARN",
          `No threading information available for follow-up email`,
          txId,
        );
      }
    }

    // Log the mail options for debugging (excluding sensitive content)
    log("INFO", "[EMAIL] Sending...", txId, {
      from: fromAddress,
      to: maskedEmail,
      subject: mailOptions.subject,
      isThreaded: email.stage > 0 && {
        inReplyTo: mailOptions.inReplyTo,
        references: mailOptions.references,
      },
    });
    console.log("[EMAIL] Sending...");

    try {
      log("INFO", `Calling nodemailer sendMail`, txId);
      logDeliveryLifecycle({
        campaignId:
          email.campaign?.id ||
          (typeof email.campaign === "string" ? email.campaign : null),
        campaignEmailId: email.id,
        recipientEmail: email.email,
        credentialId: credential.id,
        phase: "SMTP_ATTEMPT",
      });

      let sendResult: { messageId?: string; response?: string };
      const sendStartTime = Date.now();
      try {
        const rawResult = await transporter.sendMail(mailOptions);
        sendResult = {
          messageId: rawResult?.messageId,
          response: rawResult?.response,
        };
      } catch (directError: any) {
        const isTimeout =
          directError.message?.toLowerCase().includes("timeout") ||
          directError.code === "ETIMEDOUT" ||
          directError.code === "ESOCKET" ||
          directError.code === "ECONNRESET";

        if (isTimeout && typeof sendMailWithFallback === "function") {
          log(
            "WARN",
            `Direct transporter send failed (${directError.message}). Attempting sendMailWithFallback & HTTPS relay...`,
            txId,
          );
          sendResult = await sendMailWithFallback(
            credential,
            mailOptions,
            txId,
            process.env.FRONTEND_URL,
          );
        } else {
          throw directError;
        }
      }

      const messageId = sendResult?.messageId || `<${uuidv4()}@${credential.host || "smtp"}>`;
      const response = sendResult?.response || "250 OK";
      const sendDuration = Date.now() - sendStartTime;

      log("INFO", "[EMAIL] SMTP send successful", txId, {
        messageId,
        sendDuration: `${sendDuration}ms`,
      });
      console.log("[EMAIL] SMTP send successful", messageId);

      log("INFO", "[EMAIL] Status updated", txId);
      console.log("[EMAIL] Status updated");
      await updateEmailStatus(email);

      // Create campaign message record
      await createCampaignMessage(email, pitch, messageId, body, txId);

      logDeliveryLifecycle({
        campaignId:
          email.campaign?.id ||
          (typeof email.campaign === "string" ? email.campaign : null),
        campaignEmailId: email.id,
        recipientEmail: email.email,
        credentialId: credential.id,
        smtpMessageId: messageId,
        smtpResponseCode: response,
        finalDatabaseStatus: "RUNNING",
        phase: "SMTP_ACCEPTED",
      });

      log("INFO", `Email processing completed successfully`, txId, {
        duration: `${Date.now() - startTime}ms`,
      });
      return true;
    } catch (error: any) {
      logDeliveryLifecycle({
        campaignId: email.campaign?.id || (typeof email.campaign === "string" ? email.campaign : null),
        campaignEmailId: email.id,
        recipientEmail: email.email,
        credentialId: credential.id,
        errorMessage: error.message,
        smtpResponseCode: error.responseCode || error.code,
        finalDatabaseStatus: isTransientError(error) ? "PENDING (RETAINED FOR RETRY)" : "FAILED",
        phase: "FAILED",
      });

      if (isTransientError(error)) {
        // Transient network, timeout, or rate-limit issue.
        // Retain PENDING/RUNNING status in database so the queue/scheduler will retry in the next cycle.
        log(
          "WARN",
          `Transient error sending email. Retaining status for future retry: ${error.message}`,
          txId,
          {
            emailId: email.id,
            credentialId: credential.id,
            errorCode: error.code,
            responseCode: error.responseCode,
            errorMessage: error.message,
          },
        );

        // Evict cached transporter so next attempt gets a fresh connection
        removeTransporter(credential.id);

        return false;
      } else if (error.code === "EENVELOPE") {
        // Handle recipient errors
        log("ERROR", `Recipient error for email`, txId, {
          emailId: email.id,
          to: email.email,
          errorCode: error.code,
          errorMessage: error.message,
        });

        await prisma.campaignEmail.update({
          where: { id: email.id },
          data: { status: "FAILED" },
        });
        return false;
      } else {
        log("ERROR", `Error sending email`, txId, {
          error: error.message,
          stack: error.stack,
          emailId: email.id,
          credentialId: credential.id,
        });

        // For other unrecoverable errors, mark as failed
        await prisma.campaignEmail.update({
          where: { id: email.id },
          data: { status: "FAILED" },
        });
        return false;
      }
    }
  } catch (error: any) {
    log("ERROR", `Unexpected error in sendCampaignEmail`, txId, {
      error: error.message,
      stack: error.stack,
      emailId: email.id,
    });
    return false;
  } finally {
    if (lockAcquired) {
      await releaseLeadSendLock(email.id, txId);
    }
  }
}

export interface ImmediateSendOptions {
  campaignId: string;
  leadId: string;
  userId?: string;
  isTestOnly?: boolean;
  relayUrl?: string;
}

export interface ImmediateSendResult {
  success: boolean;
  leadId: string;
  recipientEmail: string;
  campaignId: string;
  stage: number;
  messageId?: string;
  smtpResponse?: string;
  durationMs?: number;
  credentialUsed?: string;
  reason?: string;
  details?: string;
  errorCode?: string;
  timestamp: string;
  finalStatus: string;
  remainingCredits?: number | null;
}

/**
 * Immediately dispatches an email to a single selected lead belonging to a campaign.
 * Reuses the existing Nodemailer, personalization, and template generation pipeline.
 * Does not corrupt normal campaign scheduling.
 */
export async function sendSingleLeadImmediate(
  options: ImmediateSendOptions,
): Promise<ImmediateSendResult> {
  const txId = uuidv4().substring(0, 8);
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  let lockAcquired = false;
  const targetLeadId = options.leadId;

  log(
    "INFO",
    `[IMMEDIATE_SEND] Starting immediate send for lead ${options.leadId}`,
    txId,
    options,
  );

  try {
    const lead = await prisma.campaignEmail.findUnique({
      where: { id: options.leadId },
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
        campaignMessages: true,
      },
    });

    if (!lead) {
      return {
        success: false,
        leadId: options.leadId,
        recipientEmail: "",
        campaignId: options.campaignId,
        stage: 0,
        reason: "Lead not found",
        details: `No lead was found with ID '${options.leadId}'.`,
        timestamp,
        finalStatus: "UNKNOWN",
      };
    }

    if (lead.campaignId !== options.campaignId) {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email || "",
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: "Campaign mismatch",
        details: "Lead does not belong to the specified campaign.",
        timestamp,
        finalStatus: lead.status || "PENDING",
      };
    }

    const campaignOwnerId = lead.campaign?.userId || lead.campaign?.user?.id;
    if (options.userId && campaignOwnerId && campaignOwnerId !== options.userId) {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email || "",
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: "Unauthorized",
        details: "You do not own this campaign.",
        timestamp,
        finalStatus: lead.status || "PENDING",
      };
    }

    // Check available user credits
    const currentUserCredits = lead.campaign?.user?.credits;
    if (typeof currentUserCredits === "number" && currentUserCredits <= 0) {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email || "",
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: "Credits depleted",
        details: "User has 0 remaining email credits. Please top up your credits to send emails.",
        timestamp,
        finalStatus: lead.status || "PENDING",
      };
    }

    if (!lead.email || !isValidEmail(lead.email)) {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email || "",
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: "Invalid email",
        details: `Recipient email '${lead.email}' is invalid.`,
        timestamp,
        finalStatus: lead.status || "PENDING",
      };
    }

    // Strict rule: if lead has already replied, do not allow sending again under any circumstances
    if (lead.status === "REPLIED") {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email,
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: "Lead already replied",
        details:
          "Emails cannot be sent to this lead because they have already replied to the campaign. Sending is permanently stopped.",
        timestamp,
        finalStatus: "REPLIED",
      };
    }

    if (lead.status === "BOUNCED" || lead.status === "UNSUBSCRIBED") {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email,
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: `Lead is ${lead.status.toLowerCase()}`,
        details: `Emails cannot be sent to this lead because their status is ${lead.status}.`,
        timestamp,
        finalStatus: lead.status,
      };
    }

    // Check if an incoming reply message exists in database (sent: false)
    const incomingReply = await prisma.campaignMessage.findFirst({
      where: { campaignEmailId: lead.id, sent: false },
    });
    if (incomingReply) {
      if (lead.status !== "REPLIED") {
        await prisma.campaignEmail.update({
          where: { id: lead.id },
          data: { status: "REPLIED" },
        });
      }
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email,
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: "Lead already replied",
        details:
          "Emails cannot be sent to this lead because an incoming reply was received. Sending is permanently stopped.",
        timestamp,
        finalStatus: "REPLIED",
      };
    }

    // Concurrency lock: ensure only one send operation runs at a time for this lead
    lockAcquired = await acquireLeadSendLock(lead.id, txId);
    if (!lockAcquired) {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email,
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: "Concurrent send in progress",
        details:
          "An email dispatch is currently in progress for this lead. Concurrent sends are blocked to prevent duplicate delivery.",
        timestamp,
        finalStatus: lead.status || "PENDING",
      };
    }

    const campaignCreds: CredentialRecord[] = (
      lead.campaign?.campaignEmailCredentials ?? []
    )
      .map((cec: any) => cec.emailCredential)
      .filter((c: any): c is CredentialRecord => Boolean(c));

    if (campaignCreds.length === 0) {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email,
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: "Missing SMTP credentials",
        details:
          "No email accounts / SMTP credentials are connected to this campaign. Please connect an account in Campaign Settings.",
        timestamp,
        finalStatus: lead.status || "PENDING",
      };
    }

    // Determine credential to use
    let credential: CredentialRecord | undefined;
    if (lead.credId) {
      credential = campaignCreds.find((c) => c.id === lead.credId);
    }

    if (!credential) {
      for (const cred of campaignCreds) {
        const sentCount = await getCredentialSentCount(cred.id);
        if (sentCount < (cred.dailyLimit || 50)) {
          credential = cred;
          break;
        }
      }

      if (!credential) {
        credential = campaignCreds[0];
      }

      // Assign credential to lead for subsequent follow-ups
      await prisma.campaignEmail.update({
        where: { id: lead.id },
        data: { credId: credential.id },
      });
    }

    if (!credential || !credential.username || !credential.password) {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email,
        campaignId: options.campaignId,
        stage: lead.stage || 0,
        reason: "Invalid credentials",
        details:
          "The connected SMTP credential has missing username or password.",
        timestamp,
        finalStatus: lead.status || "PENDING",
      };
    }

    // Determine pitch template for this stage
    const stage = lead.stage || 0;
    let pitch = lead.campaign?.pitches?.find((p: any) => p.stage === stage);
    if (!pitch && lead.campaign?.pitches?.length) {
      pitch = lead.campaign.pitches[0];
    }

    if (!pitch) {
      return {
        success: false,
        leadId: lead.id,
        recipientEmail: lead.email,
        campaignId: options.campaignId,
        stage,
        reason: "Missing template",
        details: `No email pitch template found for stage ${stage}.`,
        timestamp,
        finalStatus: lead.status || "PENDING",
      };
    }

    // Build personalization
    const personalizationData = {
      name: lead.name || "there",
      email: lead.email,
      ...(typeof lead.personalization === "string"
        ? JSON.parse(lead.personalization || "{}")
        : lead.personalization || {}),
    };

    const { subject, body: rawBody } = applyHoganPersonalization(
      pitch,
      personalizationData,
    );
    const body = normalizeEmailBody(rawBody);

    let processedBody = body;
    if (lead.campaign?.isTrackingEnabled) {
      const baseUrl = getTrackingBaseUrl();
      if (baseUrl) {
        const trackingUrl = `${baseUrl}/tracking/open?id=${lead.id}`;
        processedBody += `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;" />`;
      }
    }

    const senderName = lead.campaign?.user?.name;
    const fromAddress = senderName
      ? `"${senderName}" <${credential.username}>`
      : credential.username;

    const mailOptions: SendMailOptions = {
      from: fromAddress,
      to: lead.email.trim(),
      subject,
      html: processedBody,
      text: htmlToText(processedBody, {
        wordwrap: 130,
        selectors: [
          { selector: "img", format: "skip" },
          { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
        ],
      }),
    };

    if (stage > 0) {
      const threadingInfo = await getThreadingInfo(lead.id, txId);
      if (threadingInfo?.replyTo) {
        mailOptions.inReplyTo = threadingInfo.replyTo;
        mailOptions.references = threadingInfo.references;
      }
    }

    logDeliveryLifecycle({
      campaignId: options.campaignId,
      campaignEmailId: lead.id,
      recipientEmail: lead.email,
      credentialId: credential.id,
      phase: "SMTP_ATTEMPT",
    });

    // Send using fallback capability (port 465 <-> 587 and HTTPS relay)
    const sendResult = await sendMailWithFallback(
      credential,
      mailOptions,
      txId,
      options.relayUrl,
    );
    const durationMs = Date.now() - startTime;

    // Record CampaignMessage in database
    await prisma.campaignMessage.create({
      data: {
        sent: true,
        messageId: sendResult.messageId,
        text: processedBody,
        pitchId: pitch.id,
        campaignEmailId: lead.id,
        timestamp: new Date(),
      },
    });

    let finalStatus = lead.status || "PENDING";

    if (!options.isTestOnly) {
      // Advance stage according to campaign rules
      const nextStage = stage + 1;
      const maxStage = lead.campaign?.maxStageCount || 1;
      finalStatus = nextStage >= maxStage ? "COMPLETED" : "RUNNING";

      await prisma.campaignEmail.update({
        where: { id: lead.id },
        data: {
          stage: nextStage,
          status: finalStatus,
          sentAt: new Date(),
        },
      });
    } else {
      // Test send: preserve lead stage and status
      await prisma.campaignEmail.update({
        where: { id: lead.id },
        data: {
          sentAt: new Date(),
        },
      });
    }

    // Decrement user credit for every sent email (test send or production send)
    const targetUserId =
      lead.campaign?.user?.id ||
      lead.campaign?.userId ||
      options.userId;

    let userRemainingCredits: number | null = null;
    if (targetUserId) {
      try {
        const updatedUser = await prisma.user.update({
          where: { id: targetUserId },
          data: { credits: { decrement: 1 } },
          select: { credits: true },
        });
        userRemainingCredits = updatedUser?.credits ?? null;
      } catch (err: any) {
        log("WARN", `Could not decrement user credits: ${err.message}`, txId);
      }
    }

    logDeliveryLifecycle({
      campaignId: options.campaignId,
      campaignEmailId: lead.id,
      recipientEmail: lead.email,
      credentialId: credential.id,
      smtpMessageId: sendResult.messageId,
      smtpResponseCode: sendResult.response,
      finalDatabaseStatus: finalStatus,
      phase: "SMTP_ACCEPTED",
    });

    return {
      success: true,
      leadId: lead.id,
      recipientEmail: lead.email,
      campaignId: options.campaignId,
      stage,
      messageId: sendResult.messageId,
      smtpResponse: sendResult.response,
      durationMs,
      credentialUsed: credential.username,
      timestamp,
      finalStatus,
      remainingCredits: userRemainingCredits,
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    logDeliveryLifecycle({
      campaignId: options.campaignId,
      campaignEmailId: options.leadId,
      recipientEmail: "",
      errorMessage: error.message,
      errorCode: error.code,
      phase: "FAILED",
    });

    return {
      success: false,
      leadId: options.leadId,
      recipientEmail: "",
      campaignId: options.campaignId,
      stage: 0,
      reason: error.name || "SMTP Send Failed",
      details:
        error.message || "Failed to deliver email through SMTP transport.",
      errorCode: error.code || "ESMTP",
      durationMs,
      timestamp,
      finalStatus: "FAILED",
    };
  } finally {
    if (lockAcquired && targetLeadId) {
      await releaseLeadSendLock(targetLeadId, txId);
    }
  }
}
