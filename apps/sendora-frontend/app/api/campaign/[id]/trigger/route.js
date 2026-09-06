import { NextResponse } from "next/server";
import { jwtDecode } from "jwt-decode";
import axios from "axios";

export async function POST(request, { params }) {
  const { id: campaignId } = await params;
  const token = request.headers.get("authorization");

  if (!token) {
    return NextResponse.json(
      { success: false, reason: "Unauthorized", details: "No authorization token provided." },
      { status: 401 },
    );
  }

  try {
    const user = jwtDecode(token);
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8100";

    const response = await axios.post(
      `${backendUrl}/queue/trigger-campaign`,
      {
        campaignId,
        userId: user.userId,
      },
      {
        validateStatus: () => true, // Don't throw on HTTP error status codes
      },
    );

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    console.error(`[API] Error triggering test run for campaign ${campaignId}:`, error);
    return NextResponse.json(
      {
        success: false,
        reason: "Server Error",
        details: error.message || "Failed to reach backend trigger endpoint.",
      },
      { status: 500 },
    );
  }
}
