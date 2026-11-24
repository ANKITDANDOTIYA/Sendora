/**
 * Credential management service for email processing
 */

import nodemailer from "nodemailer";
import { v4 as uuidv4 } from "uuid";
import { log } from "./logger.js";
import type { CredentialRecord } from "../models/email.js";

// Store transporters by credential id
export const emailTransporters = new Map<string, nodemailer.Transporter>();

/**
 * Normalizes host, port, and TLS options for SMTP connection.
 * Resolves standard port/secure pairings:
 * - Port 465 is SSL/TLS direct (secure: true)
 * - Port 587 is STARTTLS (secure: false)
 * - Gmail defaults to smtp.gmail.com with port 465 (secure: true)
 */
export function normalizeSmtpConfig(
  cred: CredentialRecord,
  overridePort?: number,
): {
  host: string;
  port: number;
  secure: boolean;
} {
  let host = cred.host?.trim() || "";
  const isGmail =
    host.includes("gmail") ||
    host.includes("googlemail") ||
    Boolean(cred.username?.trim().toLowerCase().endsWith("@gmail.com")) ||
    Boolean(cred.username?.trim().toLowerCase().endsWith("@googlemail.com"));

  if (!host && isGmail) {
    host = "smtp.gmail.com";
  }

  let port = overridePort ?? cred.port;
  let secure = cred.secure;

  if (port === 465) {
    secure = true;
  } else if (port === 587) {
    secure = false;
  } else if (!port) {
    if (secure === true) {
      port = 465;
    } else if (secure === false && !isGmail) {
      port = 587;
    } else {
      // Default for Gmail and standard SMTPS is port 465 (secure: true)
      port = 465;
      secure = true;
    }
  } else {
    // Other port, use explicit secure if provided, otherwise true if port 465
    secure = cred.secure !== undefined ? Boolean(cred.secure) : port === 465;
  }

  return { host, port, secure };
}

/**
 * Removes and closes a cached transporter (e.g. after a connection error or socket timeout).
 * @param credentialId - Credential ID of the email sender.
 */
export function removeTransporter(credentialId: string): void {
  const existing = emailTransporters.get(credentialId);
  if (existing) {
    try {
      existing.close();
    } catch {}
    emailTransporters.delete(credentialId);
  }
}

/**
 * Extracts unique email credentials from campaign emails.
 * @param campaignEmails - List of campaign email objects.
 * @returns Unique email credentials.
 */
export function extractUniqueCredentials(
  campaignEmails: any[],
): CredentialRecord[] {
  const txId = uuidv4().substring(0, 8);
  log(
    "INFO",
    `Extracting unique credentials from ${campaignEmails.length} emails`,
    txId,
  );

  const credentialsMap = new Map<string, CredentialRecord>();
  let totalCredentialsFound = 0;

  campaignEmails.forEach((email: any) => {
    const creds = email.campaign?.campaignEmailCredentials;
    if (creds && Array.isArray(creds)) {
      creds.forEach((cec: any) => {
        const cred = cec.emailCredential;
        if (cred && cred.id) {
          totalCredentialsFound++;
          credentialsMap.set(cred.id, cred);
        }
      });
    }
  });

  const uniqueCredentials = Array.from(credentialsMap.values());

  log(
    "INFO",
    `Extracted ${uniqueCredentials.length} unique credentials from ${totalCredentialsFound} total credentials`,
    txId,
  );
  return uniqueCredentials;
}

/**
 * Creates Nodemailer transport instances for each unique credential.
 * @param credentialsList - List of email credentials.
 */
export function setupEmailTransporters(
  credentialsList: CredentialRecord[],
): void {
  const txId = uuidv4().substring(0, 8);
  log(
    "INFO",
    `Setting up email transporters for ${credentialsList.length} credentials`,
    txId,
  );

  let newTransporters = 0;
  let skippedTransporters = 0;
  let failedTransporters = 0;

  credentialsList.forEach((cred) => {
    // Skip if we already have a working transporter for this credential
    if (emailTransporters.has(cred.id)) {
      log("INFO", `Transporter already exists for credential ${cred.id}`, txId);
      skippedTransporters++;
      return;
    }

    // Validate credential data
    if (!cred.host || !cred.username || !cred.password) {
      log(
        "ERROR",
        `Invalid credential data for ID ${cred.id}. Missing required fields`,
        txId,
        {
          hasHost: !!cred.host,
          hasUsername: !!cred.username,
          hasPassword: !!cred.password,
        },
      );
      failedTransporters++;
      return;
    }

    try {
      const config = normalizeSmtpConfig(cred);

      log("INFO", `Creating new transporter for credential ${cred.id}`, txId, {
        host: config.host,
        port: config.port,
        secure: config.secure,
      });

      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: cred.username,
          pass: cred.password,
        },
        // Connection pool settings
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        // Generous timeouts for cloud hosting (Render / Docker / NAT / slow DNS)
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 45000,
        // Require TLS when connecting to port 587 (STARTTLS)
        requireTLS: !config.secure,
        // TLS certificate options for cloud compatibility
        tls: {
          rejectUnauthorized: false,
          minVersion: "TLSv1.2",
        },
        // Debug mode for troubleshooting
        debug: process.env.NODE_ENV !== "production",
        logger: process.env.NODE_ENV !== "production",
      });

      emailTransporters.set(cred.id, transporter);
      newTransporters++;

      // Mask username for logging
      const maskedUsername = cred.username.includes("@")
        ? cred.username.substring(0, 3) + "***@" + cred.username.split("@")[1]
        : cred.username.substring(0, 3) + "***";

      log("INFO", `Created new transporter for credential ${cred.id}`, txId, {
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: maskedUsername,
      });
    } catch (error: any) {
      log(
        "ERROR",
        `Error creating transporter for credential ${cred.id}`,
        txId,
        {
          error: error.message,
          stack: error.stack,
        },
      );
      failedTransporters++;
    }
  });

  log("INFO", `Email transporters setup complete`, txId, {
    total: credentialsList.length,
    new: newTransporters,
    skipped: skippedTransporters,
    failed: failedTransporters,
  });
}

/**
 * Gets a transport instance by credential ID.
 * @param credentialId - Credential ID of the email sender.
 * @returns Nodemailer transporter instance or null.
 */
export function getEmailTransporter(
  credentialId: string,
): nodemailer.Transporter | null {
  const txId = uuidv4().substring(0, 8);

  const transporter = emailTransporters.get(credentialId);

  if (!transporter) {
    log("WARN", `No transporter found for credential ${credentialId}`, txId);
    return null;
  } else {
    log("INFO", `Retrieved transporter for credential ${credentialId}`, txId);
    return transporter;
  }
}

/**
 * Creates a fresh direct Nodemailer transporter for immediate send
 * or batch processing without retaining stale connections in memory.
 */
export function createFreshTransporter(
  cred: CredentialRecord,
  overridePort?: number,
): nodemailer.Transporter {
  const config = normalizeSmtpConfig(cred, overridePort);

  const transportOptions: any = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: cred.username,
      pass: cred.password,
    },
    // Direct connection avoids holding dead pooled sockets across hour-long gaps
    pool: false,
    // Fast detection of blocked cloud ports (e.g. Render Free tier drops outbound 465/587)
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 15000,
    requireTLS: !config.secure,
    tls: {
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    },
    debug: process.env.NODE_ENV !== "production",
    logger: process.env.NODE_ENV !== "production",
  };

  return nodemailer.createTransport(transportOptions);
}

/**
 * Resolves the configured frontend / relay URL from parameters or environment.
 */
export function getRelayUrl(explicitUrl?: string): string | null {
  const candidate =
    explicitUrl ||
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL;

  if (!candidate) return null;

  // If candidate contains comma-separated URLs, pick the first
  const firstUrl = candidate.split(",")[0].trim();
  if (!firstUrl) return null;

  return firstUrl.replace(/\/+$/, "");
}

/**
 * Attempts to dispatch email via the HTTPS relay running on Vercel (Port 443).
 * Bypasses Render's platform firewall block on SMTP ports 25, 465, and 587.
 */
export async function sendViaRelay(
  relayBaseUrl: string,
  credential: CredentialRecord,
  mailOptions: nodemailer.SendMailOptions,
  txId = "",
): Promise<{ messageId: string; response: string; portUsed: number }> {
  const cleanUrl = relayBaseUrl.replace(/\/+$/, "");
  const relayEndpoint = `${cleanUrl}/api/email/relay`;
  const relaySecret =
    process.env.INTERNAL_RELAY_SECRET ||
    process.env.JWT_SECRET ||
    "sendora-relay-secret";

  log(
    "INFO",
    `[RELAY] Relaying email dispatch over HTTPS to ${relayEndpoint}`,
    txId,
  );

  const response = await fetch(relayEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-relay-secret": relaySecret,
    },
    body: JSON.stringify({
      credential: {
        id: credential.id,
        host: credential.host,
        port: credential.port,
        secure: credential.secure,
        username: credential.username,
        password: credential.password,
      },
      mailOptions,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as any;

  if (!response.ok || !data.success) {
    throw new Error(
      data.error ||
        `Relay request failed with status ${response.status}: ${response.statusText}`,
    );
  }

  log(
    "INFO",
    `[RELAY] Email delivered via HTTPS relay! MessageId: ${data.messageId}`,
    txId,
  );

  return {
    messageId: data.messageId,
    response: data.response || "250 OK (Relayed via Vercel)",
    portUsed: data.portUsed || 465,
  };
}

/**
 * Sends mail via Nodemailer with automatic port fallback (465 <-> 587)
 * and automatic HTTPS relay fallback via Vercel to guard against
 * cloud outbound firewall blocks (Render Free tier blocks ports 25, 465, 587).
 */
export async function sendMailWithFallback(
  credential: CredentialRecord,
  mailOptions: nodemailer.SendMailOptions,
  txId = "",
  explicitRelayUrl?: string,
): Promise<{ messageId: string; response: string; portUsed: number }> {
  const primaryConfig = normalizeSmtpConfig(credential);
  const fallbackPort = primaryConfig.port === 465 ? 587 : 465;

  try {
    const transporter = createFreshTransporter(credential, primaryConfig.port);
    log(
      "INFO",
      `Calling nodemailer sendMail on primary port ${primaryConfig.port}`,
      txId,
      {
        host: primaryConfig.host,
        port: primaryConfig.port,
        secure: primaryConfig.secure,
      },
    );
    const info = await transporter.sendMail(mailOptions);
    try {
      transporter.close();
    } catch {}
    return {
      messageId: info.messageId || `<${uuidv4()}@${primaryConfig.host}>`,
      response: info.response || "250 OK",
      portUsed: primaryConfig.port,
    };
  } catch (error: any) {
    const isTimeout =
      error.message?.toLowerCase().includes("timeout") ||
      error.code === "ETIMEDOUT" ||
      error.code === "ESOCKET" ||
      error.code === "ECONNRESET";

    if (!isTimeout) {
      throw error;
    }

    log(
      "WARN",
      `Primary port ${primaryConfig.port} failed with network timeout (${error.message}). Attempting fallback to port ${fallbackPort}...`,
      txId,
    );

    try {
      const fallbackTransporter = createFreshTransporter(credential, fallbackPort);
      const info = await fallbackTransporter.sendMail(mailOptions);
      try {
        fallbackTransporter.close();
      } catch {}
      log(
        "INFO",
        `Fallback sendMail on port ${fallbackPort} succeeded!`,
        txId,
        {
          messageId: info.messageId,
        },
      );
      return {
        messageId: info.messageId || `<${uuidv4()}@${primaryConfig.host}>`,
        response: info.response || "250 OK",
        portUsed: fallbackPort,
      };
    } catch (fallbackError: any) {
      const isFallbackTimeout =
        fallbackError.message?.toLowerCase().includes("timeout") ||
        fallbackError.code === "ETIMEDOUT" ||
        fallbackError.code === "ESOCKET" ||
        fallbackError.code === "ECONNRESET";

      log(
        "WARN",
        `Direct SMTP ports ${primaryConfig.port} and ${fallbackPort} both failed: ${fallbackError.message}`,
        txId,
      );

      // Check if HTTPS relay is available (e.g. Next.js running on Vercel)
      const relayUrl = getRelayUrl(explicitRelayUrl);
      if (relayUrl) {
        log(
          "INFO",
          `Attempting automatic fallback to HTTPS email relay via ${relayUrl}...`,
          txId,
        );
        try {
          return await sendViaRelay(relayUrl, credential, mailOptions, txId);
        } catch (relayError: any) {
          log(
            "ERROR",
            `HTTPS relay dispatch failed: ${relayError.message}`,
            txId,
          );
          throw new Error(
            `SMTP Connection Timeout: Both direct ports (${primaryConfig.port}, ${fallbackPort}) timed out and HTTPS relay at ${relayUrl} failed: ${relayError.message}`,
          );
        }
      }

      // If no relay is configured, provide an actionable error message for Render users
      if (isFallbackTimeout) {
        const enrichedError: any = new Error(
          `Connection timeout: Outbound SMTP ports ${primaryConfig.port} and ${fallbackPort} timed out. ` +
            `Render Free Tier blocks outbound SMTP ports 25, 465, and 587. ` +
            `To fix: Set FRONTEND_URL in Render environment settings to enable automatic HTTPS relay via Vercel, or upgrade to Render Starter plan ($7/mo).`,
        );
        enrichedError.code = "ETIMEDOUT";
        enrichedError.isFirewallBlock = true;
        throw enrichedError;
      }

      throw fallbackError;
    }
  }
}
