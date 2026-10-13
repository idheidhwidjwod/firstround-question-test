// The four models of the test, from free to premium, and how each is called.
// Prices: USD per 1M tokens, list prices checked 13 Oct 2026. Thinking tokens are billed as output.
import { SYSTEM_PROMPT, userPrompt, parseJson, normalise } from "./prompt.js";
import { mockReply } from "./mock.js";

export const USD_CHF = 0.8;

export const MODELS = [
  { id: "flash-lite", tier: "Free", label: "Gemini 2.5 Flash-Lite (free tier)", provider: "gemini",
    model: "gemini-2.5-flash-lite", price: { in: 0.1, out: 0.4 } },
  { id: "gpt-oss-20b", tier: "Cheapest paid", label: "GPT-OSS 20B on Groq", provider: "groq",
    model: "openai/gpt-oss-20b", price: { in: 0.075, out: 0.3 } },
  { id: "flash", tier: "Mid", label: "Gemini 2.5 Flash", provider: "gemini",
    model: "gemini-2.5-flash", price: { in: 0.3, out: 2.5 } },
  { id: "pro", tier: "Premium", label: "Gemini 2.5 Pro", provider: "gemini",
    model: "gemini-2.5-pro", price: { in: 1.25, out: 10 } },
];

export const KEY_NAMES = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY" };

export function costUSD(m, usage) {
  return (usage.input * m.price.in + (usage.output + usage.thinking) * m.price.out) / 1e6;
}

class ApiError extends Error {}

// Gemini API, generateContent. Defaults kept: each model thinks as it would in production
// (2.5 Flash and Pro think by default, Flash-Lite does not); the thinking tokens are counted.
async function callGemini(m, system, user, key, signal) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error?.message || `HTTP ${res.status}`);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  const u = data.usageMetadata || {};
  return {
    text,
    finish: cand?.finishReason || "",
    usage: { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0,
             thinking: u.thoughtsTokenCount || 0, thinkingEstimated: false },
  };
}

// Groq, OpenAI-compatible chat completions. completion_tokens covers everything generated,
// reasoning included; reasoning_tokens is used when Groq reports it, otherwise estimated from
// the returned reasoning text (about 4 characters per token) and marked as an estimate.
async function callGroq(m, system, user, key, signal) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: m.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error?.message || `HTTP ${res.status}`);
  const choice = data.choices?.[0];
  const u = data.usage || {};
  const reported = u.completion_tokens_details?.reasoning_tokens;
  const thinking = reported ?? Math.round((choice?.message?.reasoning || "").length / 4);
  return {
    text: choice?.message?.content || "",
    finish: choice?.finish_reason || "",
    usage: { input: u.prompt_tokens || 0, output: Math.max(0, (u.completion_tokens || 0) - thinking),
             thinking, thinkingEstimated: reported == null },
  };
}

// Runs one model: up to 2 attempts if the reply is not usable. Usage and cost add up over attempts.
async function runOne(m, cv, jobAd, { mock, timeoutMs }) {
  const t0 = Date.now();
  const usage = { input: 0, output: 0, thinking: 0, thinkingEstimated: false };
  const base = { modelId: m.id, model: m.model, tier: m.tier };
  let lastError = "";
  let configError = false;   // a missing key is a setup problem, not a model failure: the report leaves it out
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      let reply;
      if (mock) {
        reply = await mockReply(m, cv, jobAd);
      } else {
        const key = process.env[KEY_NAMES[m.provider]];
        if (!key) {
          configError = true;
          throw new ApiError(`${KEY_NAMES[m.provider]} is not set in .env`);
        }
        const call = m.provider === "gemini" ? callGemini : callGroq;
        reply = await call(m, SYSTEM_PROMPT, userPrompt(cv, jobAd), key, AbortSignal.timeout(timeoutMs));
      }
      for (const k of ["input", "output", "thinking"]) usage[k] += reply.usage[k];
      usage.thinkingEstimated ||= reply.usage.thinkingEstimated;
      const { questions, warnings } = normalise(parseJson(reply.text));
      return { ...base, ok: true, attempts: attempt, ms: Date.now() - t0, usage,
               costUSD: costUSD(m, usage), finish: reply.finish, questions, warnings };
    } catch (e) {
      lastError = e.name === "TimeoutError" ? `no answer within ${timeoutMs / 1000} s` : String(e.message || e);
      if (e instanceof ApiError || e.name === "TimeoutError") break;   // retry only unusable replies
    }
  }
  return { ...base, ok: false, attempts: attempt, ms: Date.now() - t0, usage, costUSD: costUSD(m, usage),
           error: lastError, ...(configError ? { configError: true } : {}) };
}

export function runAll(cv, jobAd, { mock = false, timeoutMs = 120000 } = {}) {
  return Promise.all(MODELS.map((m) => runOne(m, cv, jobAd, { mock, timeoutMs })));
}
