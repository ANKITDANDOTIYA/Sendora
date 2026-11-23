import { NextResponse } from "next/server";
import { jwtDecode } from "jwt-decode";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
const revalidate = 0;

export async function GET(request) {
  try {
    let token = request.headers.get("authorization");
    if (!token) {
      return NextResponse.json(
        { error: "Authorization token is required" },
        { status: 401 },
      );
    }
    if (token.startsWith("Bearer ")) {
      token = token.slice(7).trim();
    }

    const currUser = jwtDecode(token);
    const userId = currUser?.userId || currUser?.id;

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 },
      );
    }

    // Auto-heal legacy replied leads in database: a replied email was opened
    try {
      await prisma.campaignEmail.updateMany({
        where: {
          campaign: { userId },
          status: "REPLIED",
          opened: 0,
        },
        data: { opened: 1 },
      });
    } catch (e) {
      // non-fatal
    }

    // Compute dashboard stats via aggregates
    const [totalContacts, totalCampaigns, emailsSent, responses] =
      await Promise.all([
        prisma.campaignEmail.count({
          where: { campaign: { userId, deleted: false } },
        }),
        prisma.campaign.count({
          where: { userId, deleted: false },
        }),
        prisma.campaignMessage.count({
          where: {
            sent: true,
            campaignEmail: { campaign: { userId, deleted: false } },
          },
        }),
        prisma.campaignMessage.count({
          where: {
            sent: false,
            campaignEmail: { campaign: { userId, deleted: false } },
          },
        }),
      ]);

    // Fetch recent campaigns (limit to 6)
    const recentCampaigns = await prisma.campaign.findMany({
      where: { userId, deleted: false },
      orderBy: { created: "desc" },
      take: 6,
    });

    // For each recent campaign, compute accurate stats and real open rate percentage
    const formattedRecentCampaigns = await Promise.all(
      recentCampaigns.map(async (campaign) => {
        const [
          stagesSum,
          openedSum,
          sentMessagesCount,
          openedOrRepliedLeadsCount,
          openEventsCount,
        ] = await Promise.all([
          prisma.campaignEmail
            .aggregate({
              where: { campaignId: campaign.id },
              _sum: { stage: true },
            })
            .then((r) => r._sum.stage || 0),
          prisma.campaignEmail
            .aggregate({
              where: { campaignId: campaign.id },
              _sum: { opened: true },
            })
            .then((r) => r._sum.opened || 0),
          prisma.campaignMessage.count({
            where: {
              sent: true,
              campaignEmail: { campaignId: campaign.id },
            },
          }),
          // Any lead that opened or replied to this campaign
          prisma.campaignEmail.count({
            where: {
              campaignId: campaign.id,
              OR: [
                { opened: { gt: 0 } },
                { status: "REPLIED" },
                { campaignOpens: { some: {} } },
                { campaignMessages: { some: { sent: false } } },
              ],
            },
          }),
          prisma.campaignOpen.count({
            where: { campaignEmail: { campaignId: campaign.id } },
          }),
        ]);

        const campaignEmailsSent = Math.max(sentMessagesCount, stagesSum);
        const campaignOpenedCount = Math.max(
          openedSum,
          openedOrRepliedLeadsCount,
          openEventsCount,
        );

        // Open rate percentage (0% - 100%)
        const openRate =
          campaignEmailsSent > 0
            ? Math.min(
                100,
                Math.round((campaignOpenedCount / campaignEmailsSent) * 100),
              )
            : 0;

        return {
          id: campaign.id,
          title: campaign.title,
          emailsSent: campaignEmailsSent,
          openRate,
        };
      }),
    );

    // Fetch recent activities
    const activities = [];

    // 1. Recent email sends
    try {
      const recentSends = await prisma.campaignMessage.findMany({
        where: {
          sent: true,
          campaignEmail: { campaign: { userId, deleted: false } },
        },
        orderBy: { created: "desc" },
        take: 2,
        include: {
          campaignEmail: { include: { campaign: true } },
        },
      });

      recentSends.forEach((message) => {
        const ce = message.campaignEmail;
        activities.push({
          type: "Email sent",
          timestamp: message.created,
          details: formatRecipientDetails(ce),
          campaignId: ce?.campaign?.id,
          campaignTitle: ce?.campaign?.title || "Unknown campaign",
          recipientName: ce?.name || "",
          recipientEmail: ce?.email || "",
        });
      });
    } catch (error) {
      console.error("Error fetching recent sends:", error);
    }

    // 2. Recent email opens
    try {
      const recentOpens = await prisma.campaignOpen.findMany({
        where: {
          campaignEmail: { campaign: { userId, deleted: false } },
        },
        orderBy: { created: "desc" },
        take: 1,
        include: {
          campaignEmail: { include: { campaign: true } },
        },
      });

      recentOpens.forEach((open) => {
        const ce = open.campaignEmail;
        activities.push({
          type: "Email opened",
          timestamp: open.created,
          details: formatRecipientDetails(ce),
          campaignId: ce?.campaign?.id,
          campaignTitle: ce?.campaign?.title || "Unknown campaign",
          recipientName: ce?.name || "",
          recipientEmail: ce?.email || "",
        });
      });
    } catch (error) {
      console.error("Error fetching recent opens:", error);
    }

    // 3. Recent replies
    try {
      const recentReplies = await prisma.campaignMessage.findMany({
        where: {
          sent: false,
          campaignEmail: { campaign: { userId, deleted: false } },
        },
        orderBy: { created: "desc" },
        take: 2,
        include: {
          campaignEmail: { include: { campaign: true } },
        },
      });

      recentReplies.forEach((message) => {
        const ce = message.campaignEmail;
        activities.push({
          type: "Reply received",
          timestamp: message.created,
          details: formatRecipientDetails(ce),
          campaignId: ce?.campaign?.id,
          campaignTitle: ce?.campaign?.title || "Unknown campaign",
          recipientName: ce?.name || "",
          recipientEmail: ce?.email || "",
        });
      });
    } catch (error) {
      console.error("Error fetching recent replies:", error);
    }

    // Sort all activities by timestamp (most recent first) and limit to 10
    const recentActivities = activities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);

    return NextResponse.json(
      {
        stats: {
          total_contacts: totalContacts,
          total_campaigns: totalCampaigns,
          emails_sent: emailsSent,
          responses: responses,
        },
        recent_campaigns: formattedRecentCampaigns,
        recent_activities: recentActivities,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard statistics" },
      { status: 500 },
    );
  }
}

function formatRecipientDetails(campaignEmail) {
  if (!campaignEmail) return "Unknown recipient";
  const name = campaignEmail.name;
  const email = campaignEmail.email;
  if (name && email) return `${name} (${email})`;
  if (email) return email;
  if (name) return name;
  return "Unknown recipient";
}
