import OpenAI from "openai";

/**
 * OpenAI-compatible client pointing at Google's Gemini endpoint.
 *
 * Uses the same GEMINI_API_KEY that the Python agent service uses,
 * so the whole stack shares a single LLM provider configuration.
 *
 * The client is created lazily (see `getGeminiClient`) so that
 * missing environment variables produce a clear error at request
 * time rather than crashing the server process at boot.
 */

let _client = null;

/**
 * Returns a cached Gemini client, or throws a descriptive error
 * if GEMINI_API_KEY is not configured.
 *
 * @throws {Error} when GEMINI_API_KEY is absent
 * @returns {OpenAI}
 */
export function getGeminiClient() {
  if (_client) return _client;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "GEMINI_API_KEY is not configured. " +
        "Add it to apps/sendora-frontend/.env (local) or to your deployment environment variables.",
    );
  }

  _client = new OpenAI({
    apiKey: apiKey.trim(),
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });

  return _client;
}

/**
 * Set of retired or shutdown Google Gemini models that must not be used.
 */
const RETIRED_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-2.0-flash-exp",
  "gemini-2.5-flash",
]);

/**
 * Returns the Gemini model to use, ensuring environment variables cannot
 * accidentally override with a retired or shutdown model.
 *
 * @returns {string}
 */
export function resolveGeminiModel() {
  const envModel = process.env.GEMINI_MODEL?.trim();
  if (envModel && !RETIRED_MODELS.has(envModel)) {
    return envModel;
  }
  return "gemini-3.8-flash";
}

/** Default model used for text-enhancement tasks. */
export const GEMINI_MODEL = resolveGeminiModel();
