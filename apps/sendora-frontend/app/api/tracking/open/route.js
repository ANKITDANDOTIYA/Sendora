import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF for email open tracking
const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const emailId = searchParams.get("id");

  if (emailId) {
    try {
      const email = await prisma.campaignEmail.findUnique({
        where: { id: emailId },
        select: { id: true, opened: true },
      });

      if (email) {
        // Record open event
        await prisma.campaignOpen.create({
          data: { campaignEmailId: emailId },
        });

        // Increment opened count
        await prisma.campaignEmail.update({
          where: { id: emailId },
          data: { opened: { increment: 1 } },
        });
      }
    } catch (error) {
      console.error("[TRACKING] Error recording open event:", error);
    }
  }

  return new NextResponse(TRACKING_PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
