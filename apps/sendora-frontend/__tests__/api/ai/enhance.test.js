/**
 * Unit tests for POST /api/ai/enhance route handler.
 *
 * Strategy: mock all I/O (Gemini client, Prisma) so tests are fast,
 * offline, and never expose secrets.
 *
 * Coverage:
 *  ✓ Successful enhancement
 *  ✓ Missing text → 400
 *  ✓ Empty string text → 400
 *  ✓ Invalid enhancement type → 400
 *  ✓ Text over limit → 422
 *  ✓ Missing auth token → 401
 *  ✓ Malformed JWT → 401
 *  ✓ User not found in DB → 401
 *  ✓ Zero AI credits → 402
 *  ✓ Missing GEMINI_API_KEY → 503
 *  ✓ Gemini 401/403 auth error → 503
 *  ✓ Gemini 429 rate limit → 429
 *  ✓ Gemini generic error → 500
 *  ✓ Gemini empty response → 502
 *  ✓ Credit-decrement DB error is non-fatal (still 200)
 *  ✓ All five enhancement types accepted
 */

"use strict";

// ── Mock declarations (hoisted before imports by babel-plugin-jest) ─────────

// Mock jwt-decode – the module exports a named 'jwtDecode' function
jest.mock("jwt-decode", () => ({
  jwtDecode: jest.fn(() => ({ userId: "user-1" })),
}));

// Mock @sendora/database/client so Prisma never tries to connect
jest.mock("@sendora/database/client", () => ({ PrismaClient: jest.fn() }), { virtual: true });

// Mock the prisma singleton – prisma.js does `export default prismaInstance`
// Under CommonJS (babel transform) default exports become module.exports.default
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

// Mock the Gemini client module
const mockCreate = jest.fn();
jest.mock("@/lib/gemini", () => ({
  __esModule: true,
  getGeminiClient: jest.fn(() => ({
    chat: { completions: { create: mockCreate } },
  })),
  GEMINI_MODEL: "gemini-3.8-flash",
}));

// ── Imports (after mock declarations) ────────────────────────────────────────

const { jwtDecode } = require("jwt-decode");
const { getGeminiClient } = require("@/lib/gemini");
const { POST } = require("@/app/api/ai/enhance/route.js");

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal Next.js-compatible Request object.
 * @param {object} body
 * @param {string|null} authToken
 */
function makeRequest(body, authToken = "valid-jwt-token") {
  const headers = new Map();
  if (authToken !== null) headers.set("authorization", authToken);
  return {
    json: async () => body,
    headers: { get: (key) => headers.get(key) ?? null },
  };
}

/** Unwrap a NextResponse-like object to { status, body }. */
async function unwrap(responsePromise) {
  const res = await responsePromise;
  const body = await res.json();
  return { status: res.status, body };
}

// ── Test setup ─────────────────────────────────────────────────────────────

const GOOD_USER = { id: "user-1", aiCredits: 10 };

beforeEach(() => {
  jest.clearAllMocks();
  jwtDecode.mockReturnValue({ userId: "user-1" });
  mockFindUnique.mockResolvedValue(GOOD_USER);
  mockUpdate.mockResolvedValue({});
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: "Enhanced text" } }],
  });
  getGeminiClient.mockReturnValue({
    chat: { completions: { create: mockCreate } },
  });
  process.env.GEMINI_API_KEY = "test-key";
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/ai/enhance", () => {
  // Success path
  it("returns 200 with enhancedText on valid input", async () => {
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello world", type: "GRAMMAR" })),
    );
    expect(status).toBe(200);
    expect(body).toEqual({ enhancedText: "Enhanced text" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  // Input validation
  it("returns 400 when text is missing", async () => {
    const { status, body } = await unwrap(POST(makeRequest({ type: "GRAMMAR" })));
    expect(status).toBe(400);
    expect(body.error).toMatch(/no text/i);
  });

  it("returns 400 when text is an empty string", async () => {
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "   ", type: "GRAMMAR" })),
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/no text/i);
  });

  it("returns 400 when type is invalid", async () => {
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Some text", type: "UNKNOWN_TYPE" })),
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/unknown enhancement type/i);
  });

  it("returns 422 when text exceeds 3000 characters", async () => {
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "a".repeat(3001), type: "GRAMMAR" })),
    );
    expect(status).toBe(422);
    expect(body.error).toMatch(/3 000-character/i);
  });

  // Authentication
  it("returns 401 when authorization header is missing", async () => {
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" }, null)),
    );
    expect(status).toBe(401);
    expect(body.error).toMatch(/missing authorization/i);
  });

  it("returns 401 when JWT decode throws", async () => {
    jwtDecode.mockImplementationOnce(() => {
      throw new Error("invalid token");
    });
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(401);
    expect(body.error).toMatch(/invalid authorization/i);
  });

  it("returns 401 when user is not found in the database", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(401);
    expect(body.error).toMatch(/user not found/i);
  });

  // Credit guard
  it("returns 402 when user has no AI credits", async () => {
    mockFindUnique.mockResolvedValueOnce({ ...GOOD_USER, aiCredits: 0 });
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(402);
    expect(body.error).toMatch(/ai credits/i);
  });

  // Provider configuration
  it("returns 503 when GEMINI_API_KEY is not set", async () => {
    getGeminiClient.mockImplementationOnce(() => {
      throw new Error("GEMINI_API_KEY is not configured");
    });
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(503);
    expect(body.error).toMatch(/not configured/i);
  });

  // Provider errors
  it("returns 503 on Gemini 401 auth error", async () => {
    mockCreate.mockRejectedValueOnce(Object.assign(new Error("Unauthorized"), { status: 401 }));
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(503);
    expect(body.error).toMatch(/authentication failed/i);
  });

  it("returns 429 on Gemini rate limit", async () => {
    mockCreate.mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 }));
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(429);
    expect(body.error).toMatch(/busy/i);
  });

  it("returns 502 on Gemini 404 model retired error", async () => {
    mockCreate.mockRejectedValueOnce(Object.assign(new Error("404 status code (no body)"), { status: 404 }));
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(502);
    expect(body.error).toMatch(/unavailable or retired/i);
  });

  it("returns 500 on unexpected Gemini error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Network error"));
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(500);
    expect(body.error).toMatch(/try again/i);
  });

  it("returns 502 when Gemini returns an empty response", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [] });
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(502);
    expect(body.error).toMatch(/empty response/i);
  });

  // Non-fatal credit decrement failure
  it("still returns 200 when credit decrement fails", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("DB timeout"));
    const { status, body } = await unwrap(
      POST(makeRequest({ text: "Hello", type: "GRAMMAR" })),
    );
    expect(status).toBe(200);
    expect(body).toEqual({ enhancedText: "Enhanced text" });
  });

  // Enhancement types
  it.each(["POLITE", "GRAMMAR", "PROFESSIONAL", "INFORMAL", "HUMOUR"])(
    "accepts type=%s and calls the AI",
    async (type) => {
      const { status } = await unwrap(
        POST(makeRequest({ text: "Hello", type })),
      );
      expect(status).toBe(200);
    },
  );
});
