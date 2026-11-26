import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * HTTPS Email Relay Endpoint (runs on Vercel)
 * 
 * Render Free tier strictly blocks outbound TCP connections on SMTP ports 25, 465, and 587.
 * Vercel serverless functions permit outbound connections on ports 465 and 587.
 * This endpoint allows the backend on Render to securely relay emails over HTTPS (Port 443),
 * completely bypassing Render's platform firewall block without requiring paid upgrades.
 */
export async function POST(request) {
  try {
    const rawSecret =
      request.headers.get("x-relay-secret") ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "";
    const authHeader = rawSecret.trim();

    // Collect all valid configured secrets
    const validSecrets = [
      process.env.INTERNAL_RELAY_SECRET,
      process.env.RELAY_SECRET,
      process.env.JWT_SECRET,
    ]
      .filter(Boolean)
      .map((s) => s.trim());

    // Fallback secret if none are explicitly set in environment
    if (validSecrets.length === 0) {
      validSecrets.push("sendora-relay-secret");
    }

    if (!authHeader || !validSecrets.includes(authHeader)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized relay request" },
        { status: 401 },
      );
    }

    const { credential, mailOptions } = await request.json();

    if (!credential || !credential.username || !credential.password) {
      return NextResponse.json(
        { success: false, error: "Missing credential details (username/password required)" },
        { status: 400 },
      );
    }

    if (!mailOptions || !mailOptions.to) {
      return NextResponse.json(
        { success: false, error: "Missing mailOptions (to address required)" },
        { status: 400 },
      );
    }

    const host = credential.host?.trim() || "smtp.gmail.com";
    const initialPort = credential.port ? Number(credential.port) : 465;
    const initialSecure =
      credential.secure !== undefined
        ? Boolean(credential.secure)
        : initialPort === 465;

    // Helper to attempt send on a specific port
    async function attemptSend(port, secure) {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user: credential.username,
          pass: credential.password,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        requireTLS: !secure,
        tls: {
          rejectUnauthorized: false,
          minVersion: "TLSv1.2",
        },
      });

      try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, info, portUsed: port };
      } finally {
        try {
          transporter.close();
        } catch {}
      }
    }

    // Try primary port
    try {
      const result = await attemptSend(initialPort, initialSecure);
      return NextResponse.json({
        success: true,
        messageId: result.info.messageId,
        response: result.info.response || "250 OK",
        portUsed: result.portUsed,
        relayedVia: "vercel-https",
      });
    } catch (primaryError) {
      // If primary port timed out, try alternate port (465 <-> 587)
      const fallbackPort = initialPort === 465 ? 587 : 465;
      const fallbackSecure = fallbackPort === 465;

      console.warn(
        `[RELAY] Primary port ${initialPort} failed (${primaryError.message}). Attempting fallback to port ${fallbackPort}...`,
      );

      try {
        const fallbackResult = await attemptSend(fallbackPort, fallbackSecure);
        return NextResponse.json({
          success: true,
          messageId: fallbackResult.info.messageId,
          response: fallbackResult.info.response || "250 OK",
          portUsed: fallbackResult.portUsed,
          relayedVia: "vercel-https",
        });
      } catch (fallbackError) {
        console.error(
          `[RELAY] Both port ${initialPort} and ${fallbackPort} failed:`,
          fallbackError,
        );
        return NextResponse.json(
          {
            success: false,
            error: fallbackError.message || "Failed to deliver email through relay",
            code: fallbackError.code || "ESMTP_RELAY",
          },
          { status: 500 },
        );
      }
    }
  } catch (error) {
    console.error("[RELAY] Unhandled relay error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Internal relay error",
        code: error.code || "EINTERNAL",
      },
      { status: 500 },
    );
  }
}
