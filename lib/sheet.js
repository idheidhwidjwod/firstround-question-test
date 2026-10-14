// Copies each rated interview to the team's Google Sheet, through the Apps Script web app in sheet/apps-script.gs.
// The web app's address is built in below, so everyone who runs the app adds to the same sheet with no set-up.
// Anyone with the address can add rows, which is fine: the sheet holds nothing personal.
// What goes to the sheet: the 5 questions with their notes, the model behind each, the relevance scores, the comment,
// and each model's tokens, cost and time. Never the CV or the job ad.
import { LADDERS, USD_CHF } from "./models.js";

// The team sheet's web app address (ends in /exec), from deploying sheet/apps-script.gs on 14 Oct 2026.
export const TEAM_SHEET_URL =
  "https://script.google.com/macros/s/AKfycbzVOzdwH905FOUiYS9EDlKYZo7cO45vniyZa8MA5JsMHGoJv53arlMUs0aHFX2o1quROw/exec";

// SHEET_URL in the environment, if set, points to another sheet instead (for a test sheet, say).
const sheetUrl = () => process.env.SHEET_URL || TEAM_SHEET_URL;
export const sheetConnected = () => Boolean(sheetUrl());

export function sheetPayload(gen, rated) {
  const models = LADDERS[gen.ladder || "gemini"];
  const label = (id) => models.find((m) => m.id === id)?.label || id;
  const bullets = (items) => items.map((t) => `• ${t}`).join("\n");
  return {
    type: "session",
    version: 1,
    sessionId: gen.sessionId,
    savedAt: rated.at,
    kind: gen.participant?.kind || "",
    ladder: gen.ladder || "gemini",
    mock: Boolean(gen.mock),
    comment: rated.comment || "",
    questions: gen.interview.map((slot) => {
      const run = gen.runs.find((r) => r.modelId === slot.modelId);
      const q = run.questions[slot.index];
      return { position: slot.position, type: q.type, model: label(slot.modelId), modelId: run.model,
               effort: run.effort || "", relevance: rated.ratings[slot.position], question: q.question,
               wants: bullets(q.wants), experience: bullets(q.experience) };
    }),
    runs: gen.runs.map((r) => ({
      model: label(r.modelId), modelId: r.model, effort: r.effort || "", ok: r.ok,
      input: r.usage.input, output: r.usage.output, thinking: r.usage.thinking,
      costUSD: Number(r.costUSD.toFixed(6)), costCHF: Number((r.costUSD * USD_CHF).toFixed(6)),
      seconds: Number((r.ms / 1000).toFixed(1)), error: r.error || "",
    })),
  };
}

export async function post(body) {
  // Apps Script answers a POST with a redirect to the result; fetch follows it.
  const res = await fetch(sheetUrl(), {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`the sheet's web app did not answer (HTTP ${res.status}). Is it deployed with access for "Anyone"?`);
  }
  if (!data.ok) throw new Error(data.error || "the sheet refused the data");
  return data;
}

// Sends one rated interview. Returns the record to append to sessions.jsonl, whether it worked or not.
export async function pushSession(gen, rated) {
  const at = new Date().toISOString();
  try {
    const r = await post(sheetPayload(gen, rated));
    return { type: "sheet", sessionId: gen.sessionId, at, ok: true, participant: r.participant, duplicate: Boolean(r.duplicate) };
  } catch (e) {
    const error = e.name === "TimeoutError" ? "no answer from the sheet within 30 s" : String(e.message || e);
    return { type: "sheet", sessionId: gen.sessionId, at, ok: false, error };
  }
}
