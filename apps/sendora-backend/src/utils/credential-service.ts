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
export function normalizeSmtpConfig(cred: CredentialRecord): {
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

  let port = cred.port;
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
