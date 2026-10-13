import OpenAI from "openai";

let _openai = null;

export function getOpenAIClient() {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "OPENAI_API_KEY is not configured. Provide it in environment variables.",
    );
  }
  _openai = new OpenAI({ apiKey: apiKey.trim() });
  return _openai;
}

export const openai = new Proxy({}, {
  get(target, prop) {
    return getOpenAIClient()[prop];
  },
});
