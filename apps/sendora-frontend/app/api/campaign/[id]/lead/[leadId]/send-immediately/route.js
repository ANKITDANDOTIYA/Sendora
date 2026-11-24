import { NextResponse } from "next/server";
import { jwtDecode } from "jwt-decode";
import axios from "axios";
import nodemailer from "nodemailer";
import Hogan from "hogan.js";
import prisma from "@/lib/prisma";

export async function POST(request, { params }) {
  const { id: campaignId, leadId } = await params;
  const token = request.headers.get("authorization");

  if (!token) {
    return NextResponse.json(
      {
        success: false,
        reason: "Unauthorized",
        details: "No authorization token provided.",
      },
      { status: 401 },
    );
  }

  let user;
  try {
    user = jwtDecode(token);
  } catch {
    return NextResponse.json(
      {
        success: false,
        reason: "Unauthorized",
        details: "Invalid authorization token.",
      },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const isTestOnly = body.isTestOnly !== false;
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8100";
  const origin =
    request.headers.get("origin") ||
    request.nextUrl?.origin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "";

  // Step 1: Attempt to dispatch via backend on Render (passing relayUrl so backend can use Vercel HTTPS relay)
  try {
    const backendResponse = await axios.post(
      `${backendUrl}/queue/send-lead`,
      {
        campaignId,
        leadId,
        userId: user.userId,
        isTestOnly,
        relayUrl: origin,
      },
      {
        validateStatus: () => true,
        timeout: 14000,
      },
    );

    // If backend handled it successfully, return immediately
    if (backendResponse.status === 200 && backendResponse.data?.success) {
      return NextResponse.json(backendResponse.data, { status: 200 });
    }

    // If backend returned a functional business rule rejection, do NOT bypass it
    const reason = (backendResponse.data?.reason || "").toLowerCase();
    const isBusinessRuleRejection = [
      "lead not found",
      "campaign mismatch",
      "unauthorized",
      "credits depleted",
      "invalid email",
      "lead already replied",
      "bounced",
      "unsubscribed",
    ].some((r) => reason.includes(r));

    if (isBusinessRuleRejection) {
      return NextResponse.json(backendResponse.data, {
        status: backendResponse.status || 422,
      });
    }

    console.warn(
      `[API] Backend send-lead failed (${backendResponse.data?.details || backendResponse.statusText}). Initiating direct Vercel fallback dispatch...`,
    );
  } catch (backendError) {
    console.warn(
      `[API] Backend call to ${backendUrl}/queue/send-lead errored (${backendError.message}). Initiating direct Vercel fallback dispatch...`,
    );
  }

  // Step 2: Direct Vercel Fallback Dispatch
  // Render Free tier blocks outbound SMTP ports 25, 465, and 587.
  // When running on Vercel, outbound SMTP ports 465 and 587 are open.
  // We execute the dispatch directly using Nodemailer on Vercel and persist state via Prisma.
  try {
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
        campaignMessages: true,
      },
    });

    if (!lead) {
      return NextResponse.json(
        {
          success: false,
          reason: "Lead not found",
          details: `No lead was found with ID '${leadId}'.`,
        },
        { status: 404 },
      );
    }

    if (lead.campaignId !== campaignId) {
      return NextResponse.json(
        {
          success: false,
          reason: "Campaign mismatch",
          details: "Lead does not belong to the specified campaign.",
        },
        { status: 400 },
      );
    }

    // Verify ownership
    const ownerId = lead.campaign?.userId || lead.campaign?.user?.id;
    if (user.userId && ownerId && ownerId !== user.userId) {
      return NextResponse.json(
        {
          success: false,
          reason: "Unauthorized",
          details: "You do not own this campaign.",
        },
        { status: 403 },
      );
    }

    // Rule: do not send to replied lead
    const hasIncoming = lead.campaignMessages?.some((m) => m.sent === false);
    if (lead.status === "REPLIED" || hasIncoming) {
      return NextResponse.json(
        {
          success: false,
          reason: "Lead already replied",
          details:
            "Emails cannot be sent to this lead because they have already replied to the campaign.",
          finalStatus: "REPLIED",
        },
        { status: 422 },
      );
    }

    // Check user credits
    const userCredits = lead.campaign?.user?.credits;
    if (typeof userCredits === "number" && userCredits <= 0) {
      return NextResponse.json(
        {
          success: false,
          reason: "Credits depleted",
          details: "User has 0 remaining email credits. Please top up your credits.",
        },
        { status: 422 },
      );
    }

    // Select connected credential
    const availableCredentials = (lead.campaign?.campaignEmailCredentials || [])
      .map((cec) => cec.emailCredential)
      .filter(Boolean);

    if (availableCredentials.length === 0) {
      return NextResponse.json(
        {
          success: false,
          reason: "Missing SMTP credentials",
          details: "No email accounts / SMTP credentials are connected to this campaign.",
        },
        { status: 422 },
      );
    }

    let credential = lead.credId
      ? availableCredentials.find((c) => c.id === lead.credId)
      : availableCredentials[0];

    if (!credential) {
      credential = availableCredentials[0];
    }

    // Select pitch
    const stage = lead.stage || 0;
    let pitch = lead.campaign?.pitches?.find((p) => p.stage === stage);
    if (!pitch && lead.campaign?.pitches?.length) {
      pitch = lead.campaign.pitches[0];
    }

    if (!pitch) {
      return NextResponse.json(
        {
          success: false,
          reason: "Missing template",
          details: `No email pitch template found for stage ${stage}.`,
        },
        { status: 422 },
      );
    }

    // Personalize subject & body
    let parsedPersonalization = {};
    if (typeof lead.personalization === "string") {
      try {
        parsedPersonalization = JSON.parse(lead.personalization || "{}");
      } catch {}
    } else if (lead.personalization) {
      parsedPersonalization = lead.personalization;
    }

    const personalizationData = {
      name: lead.name || "there",
      email: lead.email,
      ...parsedPersonalization,
    };

    const subjectTemplate = Hogan.compile(pitch.subject || "");
    const bodyTemplate = Hogan.compile(pitch.message || "");
    const renderedSubject = subjectTemplate.render(personalizationData);
    let renderedBody = bodyTemplate.render(personalizationData);

    const senderName = lead.campaign?.user?.name;
    const fromAddress = senderName
      ? `"${senderName}" <${credential.username}>`
      : credential.username;

    const mailOptions = {
      from: fromAddress,
      to: lead.email.trim(),
      subject: renderedSubject,
      html: renderedBody,
    };

    // Helper to send via Nodemailer on Vercel
    async function sendMail(port, secure) {
      const transporter = nodemailer.createTransport({
        host: credential.host || "smtp.gmail.com",
        port,
        secure,
        auth: {
          user: credential.username,
          pass: credential.password,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        tls: {
          rejectUnauthorized: false,
          minVersion: "TLSv1.2",
        },
      });

      try {
        return await transporter.sendMail(mailOptions);
      } finally {
        try {
          transporter.close();
        } catch {}
      }
    }

    let sendInfo;
    try {
      sendInfo = await sendMail(465, true);
    } catch (primaryErr) {
      console.warn(
        `[API] Vercel direct send port 465 failed (${primaryErr.message}). Retrying on port 587...`,
      );
      sendInfo = await sendMail(587, false);
    }

    // Record CampaignMessage in Neon PostgreSQL
    await prisma.campaignMessage.create({
      data: {
        sent: true,
        messageId: sendInfo.messageId || `<${Date.now()}@sendora.test>`,
        text: renderedBody,
        pitchId: pitch.id,
        campaignEmailId: lead.id,
        timestamp: new Date(),
      },
    });

    // Update sentAt timestamp
    await prisma.campaignEmail.update({
      where: { id: lead.id },
      data: {
        sentAt: new Date(),
        credId: credential.id,
      },
    });

    // Decrement user credit: 1 credit per sent email
    let remainingCredits = userCredits ?? 0;
    try {
      const updatedUser = await prisma.user.update({
        where: { id: ownerId },
        data: { credits: { decrement: 1 } },
        select: { credits: true },
      });
      remainingCredits = updatedUser.credits;
    } catch {}

    return NextResponse.json(
      {
        success: true,
        leadId: lead.id,
        recipientEmail: lead.email,
        campaignId,
        stage,
        messageId: sendInfo.messageId,
        credentialUsed: credential.username,
        remainingCredits,
        dispatchedVia: "vercel-direct-fallback",
      },
      { status: 200 },
    );
  } catch (fallbackError) {
    console.error("[API] Vercel direct fallback dispatch failed:", fallbackError);
    return NextResponse.json(
      {
        success: false,
        reason: fallbackError.name || "SMTP Delivery Failed",
        details:
          fallbackError.message ||
          "Failed to deliver email through SMTP transport.",
        errorCode: fallbackError.code || "ESMTP",
      },
      { status: 422 },
    );
  }
}
