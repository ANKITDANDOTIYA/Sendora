import { NextResponse } from "next/server";
import { jwtDecode } from "jwt-decode";
import axios from "axios";

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

  try {
    const user = jwtDecode(token);
    const body = await request.json().catch(() => ({}));
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8100";

    const response = await axios.post(
      `${backendUrl}/queue/send-lead`,
      {
        campaignId,
        leadId,
        userId: user.userId,
        isTestOnly: body.isTestOnly !== false,
      },
      {
        validateStatus: () => true,
      },
    );

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    console.error(`[API] Error triggering immediate send for lead ${leadId}:`, error);
    return NextResponse.json(
      {
        success: false,
        reason: "Server Error",
        details: error.message || "Failed to reach backend immediate send endpoint.",
      },
      { status: 500 },
    );
  }
}
