import { jwtDecode } from "jwt-decode";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request) {
  let token = request.headers.get("authorization");

  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (token.startsWith("Bearer ")) {
    token = token.slice(7).trim();
  }

  try {
    const auth = jwtDecode(token);
    const userId = auth?.userId || auth?.id;

    if (!userId) {
      return NextResponse.json({ message: "Invalid authorization token" }, { status: 401 });
    }

    const record = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        avatar: true,
        credits: true,
        aiCredits: true,
        isSetup: true,
        tourCompleted: true,
        created: true,
        updated: true,
      },
    });

    if (!record) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    return NextResponse.json(record, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    console.error("[API] Error getting current user:", error);
    return NextResponse.json(
      { message: "Something went wrong" },
      { status: 500 },
    );
  }
}
