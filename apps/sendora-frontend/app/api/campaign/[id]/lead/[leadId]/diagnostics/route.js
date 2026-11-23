import { NextResponse } from "next/server";
import { jwtDecode } from "jwt-decode";
import axios from "axios";

export async function GET(request, { params }) {
  const { leadId } = await params;
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
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8100";

    const response = await axios.get(
      `${backendUrl}/queue/lead-diagnostics/${leadId}`,
      {
        validateStatus: () => true,
      },
    );

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    console.error(`[API] Error fetching diagnostics for lead ${leadId}:`, error);
    return NextResponse.json(
      {
        success: false,
        reason: "Server Error",
        details: error.message || "Failed to reach backend diagnostics endpoint.",
      },
      { status: 500 },
    );
  }
}
