// The model ladders of the test and how each model is called.
// Prices: USD per 1M tokens, list prices checked 13–14 Oct 2026. Thinking tokens are billed as output.
// role: what the decision criteria compare. "cheap" models must reach 70% within 10 points of "premium".
import { SYSTEM_PROMPT, userPrompt, parseJson, normalise } from "./prompt.js";
import { mockReply } from "./mock.js";
import { callClaude } from "./claude.js";
import { callCodex } from "./codex.js";
import { ApiError } from "./errors.js";

export const USD_CHF = 0.8;

export const LADDERS = {
  // npm start: free and low-cost APIs (keys in .env)
  gemini: [
    { id: "flash-lite", role: "cheap", tier: "Free", label: "Gemini 2.5 Flash-Lite (free tier)", provider: "gemini",
      model: "gemini-2.5-flash-lite", price: { in: 0.1, out: 0.4 } },
    { id: "gpt-oss-20b", role: "cheap", tier: "Cheapest paid", label: "GPT-OSS 20B on Groq", provider: "groq",
      model: "openai/gpt-oss-20b", price: { in: 0.075, out: 0.3 } },
    { id: "flash", role: "mid", tier: "Mid", label: "Gemini 2.5 Flash", provider: "gemini",
      model: "gemini-2.5-flash", price: { in: 0.3, out: 2.5 } },
    { id: "pro", role: "premium", tier: "Premium", label: "Gemini 2.5 Pro", provider: "gemini",
      model: "gemini-2.5-pro", price: { in: 1.25, out: 10 } },
  ],
  // npm run claude: Claude models through the claude command and the user's own Claude login
  claude: [
    { id: "haiku", role: "cheap", tier: "Cheapest", label: "Haiku 5.5", provider: "claude",
      model: "claude-haiku-5-5", effort: null, price: { in: 0.1, out: 0.5 } },
    { id: "sonnet-low", role: "mid", tier: "Mid", label: "Sonnet 5.5, low effort", provider: "claude",
      model: "claude-sonnet-5-5", effort: "low", price: { in: 2, out: 10 } },
    { id: "sonnet-high", role: "mid", tier: "Mid", label: "Sonnet 5.5, high effort", provider: "claude",
      model: "claude-sonnet-5-5", effort: "high", price: { in: 2, out: 10 } },
    { id: "opus-medium", role: "mid", tier: "Premium", label: "Opus 5.5, medium effort", provider: "claude",
      model: "claude-opus-5-5", effort: "medium", price: { in: 4, out: 20 } },
    { id: "opus-xhigh", role: "premium", tier: "Premium", label: "Opus 5.5, extra-high effort", provider: "claude",
      model: "claude-opus-5-5", effort: "xhigh", price: { in: 4, out: 20 } },
  ],
  // npm run chatgpt: OpenAI models through the codex command and the user's own ChatGPT login, for paid plans.
  // Plus and above offer GPT-6.1 Sol and GPT-6 Luna in Codex, and Astra (Plus: about 5-45 messages per 5 hours).
  // Prices checked 14 Oct 2026.
  chatgpt: [
    { id: "luna", role: "cheap", tier: "Cheapest", label: "GPT-6 Luna", provider: "codex",
      model: "gpt-6-luna", effort: null, price: { in: 0.1, cached: 0.01, out: 0.5 } },
    { id: "sol-low", role: "mid", tier: "Mid", label: "GPT-6.1 Sol, low effort", provider: "codex",
      model: "gpt-6.1-sol", effort: "low", price: { in: 2, cached: 0.1, out: 10 } },
    { id: "sol-high", role: "mid", tier: "Mid", label: "GPT-6.1 Sol, high effort", provider: "codex",
      model: "gpt-6.1-sol", effort: "high", price: { in: 2, cached: 0.1, out: 10 } },
    { id: "astra-medium", role: "mid", tier: "Premium", label: "GPT-6 Astra, medium effort", provider: "codex",
      model: "gpt-6-astra", effort: "medium", price: { in: 10, cached: 1, out: 50 } },
    { id: "astra-xhigh", role: "premium", tier: "Premium", label: "GPT-6 Astra, extra-high effort", provider: "codex",
      model: "gpt-6-astra", effort: "xhigh", price: { in: 10, cached: 1, out: 50 } },
  ],
  // npm run chatgpt-free: for Free and Go plans, which refuse Sol and Astra ("not supported when using Codex with a
  // ChatGPT account"). Tested on 14 Oct 2026 with such an account: these five all answered.
  "chatgpt-free": [
    { id: "luna-low", role: "cheap", tier: "Cheapest", label: "GPT-6 Luna, low effort", provider: "codex",
      model: "gpt-6-luna", effort: "low", price: { in: 0.1, cached: 0.01, out: 0.5 } },
    { id: "luna-high", role: "cheap", tier: "Cheapest", label: "GPT-6 Luna, high effort", provider: "codex",
      model: "gpt-6-luna", effort: "high", price: { in: 0.1, cached: 0.01, out: 0.5 } },
    { id: "luna-5-6", role: "cheap", tier: "Cheap", label: "GPT-5.6 Luna", provider: "codex",
      model: "gpt-5.6-luna", effort: null, price: { in: 0.2, cached: 0.02, out: 1.2 } },
    { id: "terra-medium", role: "mid", tier: "Premium", label: "GPT-5.6 Terra, medium effort", provider: "codex",
      model: "gpt-5.6-terra", effort: "medium", price: { in: 2, cached: 0.2, out: 12 } },
    { id: "terra-xhigh", role: "premium", tier: "Premium", label: "GPT-5.6 Terra, extra-high effort", provider: "codex",
      model: "gpt-5.6-terra", effort: "xhigh", price: { in: 2, cached: 0.2, out: 12 } },
  ],
};
export const MODELS = LADDERS.gemini;
export const KEY_NAMES = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY" };
const TIMEOUT_MS = { gemini: 120000, groq: 120000, claude: 300000, codex: 300000 };

// Cache writes cost 1.25× input (Claude; its caching is switched off for these runs). Cache reads cost the model's
// cached-input price, or 0.1× input when none is listed. Thinking tokens are billed as output.
export function costUSD(m, usage) {
  const p = m.price;
  return (usage.input * p.in + (usage.cacheWrite || 0) * p.in * 1.25 + (usage.cacheRead || 0) * (p.cached ?? p.in * 0.1)
          + (usage.output + usage.thinking) * p.out) / 1e6;
}

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

function call(m, cv, jobAd, timeoutMs, configErrorFlag) {
  if (m.provider === "claude") return callClaude(m, SYSTEM_PROMPT, userPrompt(cv, jobAd), timeoutMs);
  if (m.provider === "codex") return callCodex(m, SYSTEM_PROMPT, userPrompt(cv, jobAd), timeoutMs);
  const key = process.env[KEY_NAMES[m.provider]];
  if (!key) {
    configErrorFlag.set = true;
    throw new ApiError(`${KEY_NAMES[m.provider]} is not set in .env`);
  }
  const fn = m.provider === "gemini" ? callGemini : callGroq;
  return fn(m, SYSTEM_PROMPT, userPrompt(cv, jobAd), key, AbortSignal.timeout(timeoutMs));
}

// Runs one model: up to 2 attempts if the reply is not usable. Usage and cost add up over attempts.
async function runOne(m, index, cv, jobAd, { mock, timeoutMs }) {
  const t0 = Date.now();
  const usage = { input: 0, output: 0, thinking: 0, thinkingEstimated: false, cacheWrite: 0, cacheRead: 0 };
  const base = { modelId: m.id, model: m.model, effort: m.effort || null, tier: m.tier };
  const configError = { set: false };   // a missing key is a setup problem, not a model failure: the report leaves it out
  const limit = timeoutMs ?? TIMEOUT_MS[m.provider];
  let lastError = "";
  let extra = null;
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      const reply = mock ? await mockReply(m, index, cv, jobAd) : await call(m, cv, jobAd, limit, configError);
      for (const k of ["input", "output", "thinking", "cacheWrite", "cacheRead"]) usage[k] += reply.usage[k] || 0;
      usage.thinkingEstimated ||= reply.usage.thinkingEstimated;
      extra = reply.extra || extra;
      const { questions, warnings } = normalise(parseJson(reply.text));
      return { ...base, ok: true, attempts: attempt, ms: Date.now() - t0, usage, costUSD: costUSD(m, usage),
               finish: reply.finish, questions, warnings, ...(extra ? { extra } : {}) };
    } catch (e) {
      lastError = e.name === "TimeoutError" ? `no answer within ${limit / 1000} s` : String(e.message || e);
      if (e instanceof ApiError || e.name === "TimeoutError") break;   // retry only unusable replies
    }
  }
  return { ...base, ok: false, attempts: attempt, ms: Date.now() - t0, usage, costUSD: costUSD(m, usage),
           error: lastError, ...(configError.set ? { configError: true } : {}), ...(extra ? { extra } : {}) };
}

export function runAll(cv, jobAd, { ladder = "gemini", mock = false, timeoutMs } = {}) {
  return Promise.all(LADDERS[ladder].map((m, i) => runOne(m, i, cv, jobAd, { mock, timeoutMs })));
}
