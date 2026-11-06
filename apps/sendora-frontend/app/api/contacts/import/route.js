import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request) {
  try {
    const { contacts, campaign } = await request.json();

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return NextResponse.json(
        { message: "No contacts provided" },
        { status: 400 },
      );
    }

    if (!campaign) {
      return NextResponse.json(
        { message: "Campaign ID is required" },
        { status: 400 },
      );
    }

    // 1. Normalize and deduplicate within incoming contacts list
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
        { message: "No valid contact emails provided" },
        { status: 400 },
      );
    }

    // 2. Query existing contacts in this campaign to prevent duplicate associations
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

    // 3. Filter out contacts that already exist in this campaign
    const newContacts = uniqueIncoming.filter(
      (c) => !existingEmailSet.has(c.email),
    );

    // If single lead already exists, return 409 Conflict
    if (newContacts.length === 0) {
      const message =
        uniqueIncoming.length === 1
          ? `Lead (${uniqueIncoming[0].email}) already exists in this campaign`
          : "All submitted leads already exist in this campaign";
      return NextResponse.json(
        { message, count: 0, duplicateCount: existing.length },
        { status: 409 },
      );
    }

    // 4. Create new contacts
    const created = await prisma.campaignEmail.createMany({
      data: newContacts.map((c) => ({
        name: c.name || "",
        email: c.email,
        campaignId: campaign,
        status: "PENDING",
        sentAt: new Date(),
        opened: 0,
        stage: 0,
        personalization: c.personalization || undefined,
      })),
    });

    return NextResponse.json({
      message: "Contacts imported",
      count: created.count,
      duplicateCount: existing.length,
      items: newContacts,
    });
  } catch (error) {
    console.error(`[API] Error importing contacts:`, error);
    return NextResponse.json(
      { message: "Something went wrong" },
      { status: 500 },
    );
  }
}
