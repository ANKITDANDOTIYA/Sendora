import nodemailer from "nodemailer";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request, { params }) {
  const campaignId = params.campaign_id;

  try {
    const { campaignEmailId, text, messageId } = await request.json();

    if (!campaignEmailId || !text) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 },
      );
    }

    const campaignEmail = await prisma.campaignEmail.findUnique({
      where: { id: campaignEmailId },
      include: { cred: true },
    });

    if (!campaignEmail) {
      return NextResponse.json(
        { message: "Campaign email not found" },
        { status: 404 },
      );
    }

    const recipientEmail = campaignEmail.email;
    const recipientName = campaignEmail.name;

    if (!campaignEmail.cred) {
      return NextResponse.json(
        { message: "No email credentials found for this contact" },
        { status: 404 },
      );
    }

    const emailCredential = campaignEmail.cred;

    const port = emailCredential.port ? Number(emailCredential.port) : 465;
    const secure =
      port === 465 ? true : port === 587 ? false : Boolean(emailCredential.secure);

    const transporter = nodemailer.createTransport({
      host: emailCredential.host || "smtp.gmail.com",
      port,
      secure,
      auth: {
        user: emailCredential.username,
        pass: emailCredential.password,
      },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 45000,
      tls: {
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
      },
    });

    await transporter.sendMail({
      from: emailCredential.username,
      to: recipientEmail,
      subject: `Re: ${recipientName || "Your message"}`,
      text: text,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      `[API] Error sending reply for campaign ${campaignId}:`,
      error,
    );
    return NextResponse.json(
      { message: error?.message || "Failed to send reply" },
      { status: 500 },
    );
  }
}
