// Firstround question test: the local server of the Assignment 5 prototype. No dependencies.
//   npm start            Gemini and Groq models (keys in .env)
//   npm run claude       Claude models through the claude command and your own Claude login
//   npm run chatgpt      OpenAI models through the codex command and your own ChatGPT login (paid plans;
//                        chatgpt-free: the models Free and Go plans offer)
//   npm run mock         no keys needed: placeholder questions, saved as mock (claude-mock: the same for Claude)
// Every rated interview is also copied to the team's Google Sheet (address in lib/sheet.js, script in sheet/).
// Privacy: the CV and the job ad go to the models and are never written to disk or sent to the sheet.
// Only this computer can open the page (the server listens on 127.0.0.1).
import http from "node:http";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { randomUUID, randomInt } from "node:crypto";
import path from "node:path";
import { ROOT, loadEnv } from "./lib/env.js";
import { LADDERS, KEY_NAMES, runAll } from "./lib/models.js";
import { mixInterview } from "./lib/prompt.js";
import { claudeStatus } from "./lib/claude.js";
import { codexStatus } from "./lib/codex.js";
import { sheetConnected, pushSession } from "./lib/sheet.js";
import { SURVEY } from "./lib/survey.js";

loadEnv();
const PORT = Number(process.env.PORT) || 8787;
const MOCK = process.argv.includes("--mock") || process.env.MOCK === "1";
const argLadder = process.argv.includes("--ladder") ? process.argv[process.argv.indexOf("--ladder") + 1] : null;
const LADDER = argLadder || process.env.LADDER || "gemini";
if (!LADDERS[LADDER]) throw new Error(`Unknown ladder "${LADDER}": use ${Object.keys(LADDERS).join(" or ")}`);
const RESULTS = path.join(ROOT, "results", "sessions.jsonl");
// The command behind the Claude or ChatGPT ladder: found? logged in? (checked once, at start)
const cliStatus = MOCK ? Promise.resolve(null)
  : LADDER === "claude" ? claudeStatus() : LADDER.startsWith("chatgpt") ? codexStatus() : Promise.resolve(null);
const openSessions = new Map(); // sessionId -> { count, code, gen }: what to rate, the number, the saved record
const sheetState = () => (sheetConnected() ? (MOCK ? "mock" : "on") : "off");

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function save(record) {
  await mkdir(path.dirname(RESULTS), { recursive: true });
  await appendFile(RESULTS, JSON.stringify(record) + "\n");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const fail = (status, message) => Object.assign(new Error(message), { status });

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw fail(413, "Too much text.");
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw fail(400, "Invalid request.");
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml" };

async function serveStatic(res, urlPath) {
  const [dir, rel] = ["public", urlPath === "/" ? "index.html" : urlPath.slice(1)];
  const base = path.join(ROOT, dir);
  const file = path.resolve(base, decodeURIComponent(rel));
  if (!file.startsWith(base + path.sep)) return send(res, 404, "Not found", TYPES[".txt"]);
  try {
    send(res, 200, await readFile(file), TYPES[path.extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", TYPES[".txt"]);
  }
}

// Participants are numbered automatically on each computer: P1, P2… (mock sessions have their own count).
// A number is used once that participant's ratings are saved, so an abandoned session leaves no gap.
async function usedNumbers() {
  const used = new Set();
  let lines = [];
  try {
    lines = (await readFile(RESULTS, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return used;   // no results yet
  }
  const codeOf = new Map(lines.filter((r) => r.type === "generated" && Boolean(r.mock) === MOCK)
    .map((r) => [r.sessionId, r.participant?.code]));
  for (const r of lines) {
    if (r.type !== "rated" || !codeOf.has(r.sessionId)) continue;
    const n = Number(/^P(\d+)$/.exec(r.participant || codeOf.get(r.sessionId) || "")?.[1]);
    if (n) used.add(n);
  }
  return used;
}

async function nextParticipant() {
  const used = await usedNumbers();
  return `P${Math.max(0, ...used) + 1}`;
}

async function status(res) {
  const keys = Object.fromEntries(Object.entries(KEY_NAMES).map(([p, k]) => [p, Boolean(process.env[k])]));
  send(res, 200, { mock: MOCK, ladder: LADDER, models: LADDERS[LADDER].length, keys, cli: await cliStatus,
                   nextParticipant: await nextParticipant(), sheet: sheetState(), survey: SURVEY });
}

async function generate(req, res) {
  const b = await readBody(req);
  const kind = ["job seeker", "in a job"].includes(b.kind) ? b.kind : null;
  const cv = String(b.cv || "");
  const jobAd = String(b.jobAd || "");
  const missing = [];
  if (!kind) missing.push("who the participant is");
  if (b.consent !== true) missing.push("the consent tick");
  if (jobAd.trim().length < 200) missing.push("the job ad");
  if (cv.trim().length < 200) missing.push("the CV");
  if (missing.length) throw fail(400, `Missing: ${missing.join(", ")}.`);
  if (cv.length > 20000 || jobAd.length > 20000) throw fail(400, "The CV and the job ad must each be under 20,000 characters.");

  // Every model writes a full interview (so its cost per interview is measured); the participant sees one
  // interview that mixes them: question n comes from the model drawn for position n.
  const runs = await runAll(cv, jobAd, { ladder: LADDER, mock: MOCK });
  for (const r of runs) if (!r.ok) console.log(`  ${r.model}${r.effort ? ` (${r.effort})` : ""} failed: ${r.error}`);
  const working = runs.filter((r) => r.ok);
  if (!working.length) return send(res, 200, { sessionId: null, questions: [] });
  const slots = mixInterview(shuffle(working), () => randomInt(1000) / 1000);
  const sessionId = randomUUID();
  openSessions.clear();   // one participant at a time: an unfinished earlier session gives its number back
  const code = await nextParticipant();
  const gen = { type: "generated", sessionId, at: new Date().toISOString(), mock: MOCK, ladder: LADDER,
                participant: { code, kind }, input: { cvChars: cv.length, jobAdChars: jobAd.length },
                runs, interview: slots.map(({ position, modelId, index }) => ({ position, modelId, index })) };
  await save(gen);
  openSessions.set(sessionId, { count: slots.length, code, gen });
  // The page gets the questions only: no model names, costs or what a question is based on.
  send(res, 200, { sessionId, participant: code, questions: slots.map(({ position, question: q }) =>
    ({ position, question: q.question, wants: q.wants, tips: q.tips })) });
}

async function rate(req, res) {
  const b = await readBody(req);
  const open = openSessions.get(b.sessionId);
  if (!open) throw fail(400, "This session is unknown or already saved. Start again from Setup.");
  const { count } = open;
  // If the number was taken in the meantime (a second tab, say), the participant gets the next free one.
  const code = (await usedNumbers()).has(Number(open.code.slice(1))) ? await nextParticipant() : open.code;
  const ratings = {};
  for (let pos = 1; pos <= count; pos++) {
    const v = b.ratings?.[pos];
    if (!(Number.isInteger(v) && v >= 1 && v <= 5)) throw fail(400, `Question ${pos} is not rated yet.`);
    ratings[pos] = v;   // relevance, 1 to 5
  }
  const survey = {};   // the two questions about paying, asked after the interview questions
  for (const q of SURVEY) {
    const code = b.survey?.[q.key];
    if (!q.options.some((o) => o.code === code)) throw fail(400, "The two last questions are not answered yet.");
    survey[q.key] = code;
  }
  const rated = { type: "rated", sessionId: b.sessionId, at: new Date().toISOString(), participant: code, ratings, survey,
                  comment: String(b.comment || "").slice(0, 2000) };
  await save(rated);
  openSessions.delete(b.sessionId);
  // The copy to the team's sheet never blocks the local save; if it fails, npm run sync-sheet sends it later.
  let sheet = { state: sheetState() };
  if (sheet.state === "on") {
    const rec = await pushSession(open.gen, rated);
    await save(rec);
    sheet = { state: "on", ok: rec.ok, error: rec.error };
    if (!rec.ok) console.log(`  Google Sheet: not sent (${rec.error}). Run npm run sync-sheet later.`);
  }
  send(res, 200, { ok: true, participant: code, sheet });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/status") return await status(res);
    if (req.method === "POST" && url.pathname === "/api/generate") return await generate(req, res);
    if (req.method === "POST" && url.pathname === "/api/rate") return await rate(req, res);
    if (req.method === "GET") return await serveStatic(res, url.pathname);
    send(res, 405, { error: "Method not allowed." });
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : "Server error: see the terminal." });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Firstround question test: http://127.0.0.1:${PORT}${MOCK ? "   (MOCK: no AI is called)" : ""}`);
  console.log(`  Models: ${LADDERS[LADDER].map((m) => m.label).join(" · ")}`);
  console.log(`  Google Sheet: ${{ on: "connected, every rated interview is copied there",
    mock: "connected, but mock sessions are not sent", off: "not set up yet (TEAM_SHEET_URL in lib/sheet.js is empty): results stay here" }[sheetState()]}`);
  if (!MOCK && LADDER === "gemini") {
    for (const [provider, key] of Object.entries(KEY_NAMES)) {
      if (!process.env[key]) console.log(`  ${key} is missing in .env: the ${provider} models will fail.`);
    }
  }
  if (!MOCK && (LADDER === "claude" || LADDER.startsWith("chatgpt"))) {
    const [tool, account, login] = LADDER === "claude" ? ["claude", "Claude", "claude auth login"] : ["codex", "ChatGPT", "codex login"];
    cliStatus.then((s) => console.log(s?.found
      ? `  ${tool} ${s.version}: ${s.auth === "api key" ? "an API key" : s.auth === "account" ? `your ${account} login${s.plan ? ` (${s.plan})` : ""}` : `NOT LOGGED IN: run ${login}`}`
      : `  The ${tool} command was not found: install it and log in (see SETUP.md).`));
  }
});
