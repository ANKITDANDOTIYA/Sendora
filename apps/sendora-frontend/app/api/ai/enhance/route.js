import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini";
import prisma from "@/lib/prisma";
import { jwtDecode } from "jwt-decode";
import { NextResponse } from "next/server";

/**
 * POST /api/ai/enhance
 *
 * Enhances a given piece of email text using Gemini AI.
 *
 * Request body  : { text: string, type: "POLITE"|"GRAMMAR"|"PROFESSIONAL"|"INFORMAL"|"HUMOUR" }
 * Success body  : { enhancedText: string }
 * Error body    : { error: string }   (no sensitive details exposed to client)
 */

const PROMPTS = {
  POLITE:
    "Provided is the email that I am writing. Just make it more POLITE, that's it. Keep the context same, without changing it much, and preserve any HTML formatting or placeholders like {{name}}. Keep it as humane as possible, using simple english words.",
  GRAMMAR:
    "Provided is the email that I am writing. Just correct the GRAMMATICAL MISTAKES if any, that's it, preserving any HTML formatting or placeholders like {{name}}.",
  PROFESSIONAL:
    "Provided is the email that I am writing. Just make sure it sounds PROFESSIONAL, that's it. Keep the context same, without changing it much, and preserve any HTML formatting or placeholders like {{name}}. Keep it as humane as possible, using simple english words.",
  INFORMAL:
    "Provided is the email that I am writing. Just make sure it sounds Informal and friendly, that's it. Keep the context same, without changing it much, and preserve any HTML formatting or placeholders like {{name}}. Keep it as humane as possible, using simple english words.",
  HUMOUR:
    "Provided is the email that I am writing. Just add little, subtle HUMOR, wherever possible, that's it. Keep the context same, without changing it much, and preserve any HTML formatting or placeholders like {{name}}. Keep it as humane as possible, using simple english words.",
};

const VALID_TYPES = Object.keys(PROMPTS);

export async function POST(request) {
  console.log("[enhance] Received text enhancement request");

  // ── Parse & validate request body ────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    console.error("[enhance] Failed to parse request body");
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { text, type = "GRAMMAR" } = body;

  if (!text || typeof text !== "string" || text.trim() === "") {
    console.error("[enhance] Missing or empty text field");
    return NextResponse.json(
      { error: "No text provided. Write your email first, then click Enhance with AI." },
      { status: 400 },
    );
  }

  if (!VALID_TYPES.includes(type)) {
    console.error(`[enhance] Unknown enhancement type: ${type}`);
    return NextResponse.json(
      { error: `Unknown enhancement type '${type}'. Valid types: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  if (text.length > 3000) {
    return NextResponse.json(
      { error: "Text exceeds the 3 000-character limit. Please upgrade your plan." },
      { status: 422 },
    );
  }

  // ── Authenticate ──────────────────────────────────────────────────────────
  let currUser;
  try {
    const token = request.headers.get("authorization");
    if (!token) {
      return NextResponse.json({ error: "Missing authorization token" }, { status: 401 });
    }
    currUser = jwtDecode(token);
  } catch {
    console.error("[enhance] Failed to decode authorization token");
    return NextResponse.json({ error: "Invalid authorization token" }, { status: 401 });
  }

  // ── Database look-up ──────────────────────────────────────────────────────
  let user;
  try {
    user = await prisma.user.findUnique({ where: { id: currUser.userId } });
  } catch (dbError) {
    console.error("[enhance] Database error while fetching user:", dbError.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!user) {
    console.error(`[enhance] User not found: ${currUser.userId}`);
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // ── AI credits guard ──────────────────────────────────────────────────────
  if (user.aiCredits !== null && user.aiCredits <= 0) {
    return NextResponse.json(
      { error: "You have used all your AI credits. Please upgrade your plan." },
      { status: 402 },
    );
  }

  // ── Gemini enhancement ────────────────────────────────────────────────────
  let enhancedText;
  try {
    const client = getGeminiClient();

    console.log(`[enhance] Calling Gemini model=${GEMINI_MODEL} type=${type} userId=${currUser.userId}`);

    const response = await client.chat.completions.create({
      model: GEMINI_MODEL,
      messages: [
        { role: "system", content: PROMPTS[type] },
        { role: "user", content: text },
      ],
    });

    enhancedText = response.choices?.[0]?.message?.content;

    if (!enhancedText) {
      console.error("[enhance] Gemini returned an empty or malformed response", JSON.stringify(response));
      return NextResponse.json(
        { error: "AI returned an empty response. Please try again." },
        { status: 502 },
      );
    }
  } catch (aiError) {
    // Categorise provider errors for server logs without leaking secrets or user prompts
    if (aiError.message?.includes("GEMINI_API_KEY")) {
      console.error("[enhance] Configuration error: GEMINI_API_KEY is missing or invalid");
      return NextResponse.json(
        { error: "AI service is not configured. Contact the administrator." },
        { status: 503 },
      );
    }

    if (aiError.status === 401 || aiError.status === 403) {
      console.error(`[enhance] Gemini authentication failed (status=${aiError.status}) – check GEMINI_API_KEY`);
      return NextResponse.json(
        { error: "AI service authentication failed. Contact the administrator." },
        { status: 503 },
      );
    }

    if (aiError.status === 404) {
      console.error(
        `[enhance] Gemini model or endpoint not found (status=404, model=${GEMINI_MODEL}):`,
        aiError.message || "Model not found or retired",
      );
      return NextResponse.json(
        { error: `The configured AI model (${GEMINI_MODEL}) is unavailable or retired.` },
        { status: 502 },
      );
    }

    if (aiError.status === 429) {
      console.error("[enhance] Gemini rate limit exceeded (status=429):", aiError.message);
      return NextResponse.json(
        { error: "AI service is busy. Please wait a moment and try again." },
        { status: 429 },
      );
    }

    console.error(
      `[enhance] Unexpected AI error (status=${aiError.status || "N/A"}, model=${GEMINI_MODEL}, code=${aiError.code || "N/A"}):`,
      aiError.message ?? aiError,
    );
    return NextResponse.json(
      { error: "Failed to enhance text. Please try again." },
      { status: 500 },
    );
  }

  // ── Deduct AI credit ──────────────────────────────────────────────────────
  try {
    await prisma.user.update({
      where: { id: currUser.userId },
      data: { aiCredits: { decrement: 1 } },
    });
    console.log(`[enhance] Deducted 1 AI credit from userId=${currUser.userId}`);
  } catch (creditError) {
    // Non-fatal: still return the enhanced text, log the failure
    console.error("[enhance] Failed to decrement AI credits:", creditError.message);
  }

  console.log(`[enhance] Success userId=${currUser.userId} type=${type}`);
  return NextResponse.json({ enhancedText });
}
