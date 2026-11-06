import { NextResponse } from "next/server";
import Papa from "papaparse";
import prisma from "@/lib/prisma";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const campaign = formData.get("campaign");

    if (!file) {
      return NextResponse.json(
        { message: "No file provided" },
        { status: 400 },
      );
    }

    if (!campaign) {
      return NextResponse.json(
        { message: "Campaign ID is required" },
        { status: 400 },
      );
    }

    const content = await file.text();

    const jsonData = Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
    });

    const contacts = jsonData.data;

    if (!contacts || contacts.length === 0) {
      return NextResponse.json(
        { message: "No contacts found in file" },
        { status: 400 },
      );
    }

    // 1. Deduplicate within the file itself
    const seenEmails = new Set();
    const uniqueIncoming = [];
    for (const c of contacts) {
      if (!c.email || typeof c.email !== "string") continue;
      const normalizedEmail = c.email.trim().toLowerCase();
      if (!seenEmails.has(normalizedEmail)) {
        seenEmails.add(normalizedEmail);
        uniqueIncoming.push({
          ...c,
          name: (c.name || "").trim(),
          email: normalizedEmail,
        });
      }
    }

    if (uniqueIncoming.length === 0) {
      return NextResponse.json(
        { message: "No valid contact emails found in CSV" },
        { status: 400 },
      );
    }

    // 2. Query existing contacts in the campaign to prevent duplicates
    const incomingEmails = uniqueIncoming.map((c) => c.email);
    const existing = await prisma.campaignEmail.findMany({
      where: {
        campaignId: campaign,
        email: { in: incomingEmails, mode: "insensitive" },
      },
      select: { email: true },
    });

    const existingEmailSet = new Set(
      existing.map((e) => (e.email || "").trim().toLowerCase()),
    );

    const newContacts = uniqueIncoming.filter(
      (c) => !existingEmailSet.has(c.email),
    );

    let createdCount = 0;
    if (newContacts.length > 0) {
      const created = await prisma.campaignEmail.createMany({
        data: newContacts.map((c) => ({
          name: c.name || "",
          email: c.email,
          campaignId: campaign,
          status: "PENDING",
          verified: "PENDING",
          sentAt: new Date(),
          opened: 0,
          stage: 0,
          personalization: c.personalization
            ? typeof c.personalization === "string"
              ? JSON.parse(c.personalization)
              : c.personalization
            : undefined,
        })),
      });
      createdCount = created.count;
    }

    return NextResponse.json({
      message: "Contacts imported",
      count: createdCount,
      duplicateCount:
        existing.length + (contacts.length - uniqueIncoming.length),
    });
  } catch (error) {
    console.error("[API] Error importing contacts from file:", error);
    return NextResponse.json(
      { message: "Something went wrong" },
      { status: 500 },
    );
  }
}
