// Firstround question test: the local server of the Assignment 5 prototype. No dependencies.
//   npm start       real models (keys in .env)
//   npm run mock    no keys needed: placeholder questions, saved as mock
// Privacy: the CV and the job ad go to the models and are never written to disk.
// Only this computer can open the page (the server listens on 127.0.0.1).
import http from "node:http";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID, randomInt } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS, KEY_NAMES, runAll } from "./lib/models.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, ".env"));
const PORT = Number(process.env.PORT) || 8787;
const MOCK = process.argv.includes("--mock") || process.env.MOCK === "1";
const RESULTS = path.join(ROOT, "results", "sessions.jsonl");
const LETTERS = ["A", "B", "C", "D"];
const openSessions = new Map(); // sessionId -> letters that can be rated, until the ratings are saved

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

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
  const [dir, rel] = urlPath.startsWith("/samples/") ? ["samples", urlPath.slice(9)]
    : ["public", urlPath === "/" ? "index.html" : urlPath.slice(1)];
  const base = path.join(ROOT, dir);
  const file = path.resolve(base, decodeURIComponent(rel));
  if (!file.startsWith(base + path.sep)) return send(res, 404, "Not found", TYPES[".txt"]);
  try {
    send(res, 200, await readFile(file), TYPES[path.extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", TYPES[".txt"]);
  }
}

function status(res) {
  const keys = Object.fromEntries(Object.entries(KEY_NAMES).map(([p, k]) => [p, Boolean(process.env[k])]));
  send(res, 200, { mock: MOCK, keys, models: MODELS.length });
}

async function generate(req, res) {
  const b = await readBody(req);
  const code = String(b.code || "").trim().toUpperCase();
  const facilitator = String(b.facilitator || "").trim().toUpperCase().slice(0, 4);
  const kind = ["job seeker", "in a job"].includes(b.kind) ? b.kind : null;
  const cv = String(b.cv || "");
  const jobAd = String(b.jobAd || "");
  const missing = [];
  if (!/^[A-Z]{1,4}$/.test(facilitator)) missing.push("your initials");
  if (!/^P\d{1,3}$/.test(code)) missing.push("a participant code like P1");
  if (!kind) missing.push("who the participant is");
  if (b.consent !== true) missing.push("the consent tick");
  if (jobAd.trim().length < 200) missing.push("the job ad");
  if (cv.trim().length < 200) missing.push("the CV");
  if (missing.length) throw fail(400, `Missing: ${missing.join(", ")}.`);
  if (cv.length > 20000 || jobAd.length > 20000) throw fail(400, "The CV and the job ad must each be under 20,000 characters.");

  const runs = await runAll(cv, jobAd, { mock: MOCK });
  const letters = shuffle(LETTERS);
  const placed = runs.map((r, i) => ({ letter: letters[i], ...r })).sort((x, y) => x.letter.localeCompare(y.letter));
  const sessionId = randomUUID();
  for (const r of placed) if (!r.ok) console.log(`  set ${r.letter} (${r.model}) failed: ${r.error}`);
  if (!placed.some((r) => r.ok)) return send(res, 200, { sessionId: null, sets: placed.map((r) => ({ letter: r.letter, ok: false })) });
  await save({ type: "generated", sessionId, at: new Date().toISOString(), mock: MOCK,
               participant: { facilitator, code, kind }, input: { cvChars: cv.length, jobAdChars: jobAd.length },
               runs: placed });
  openSessions.set(sessionId, placed.filter((r) => r.ok).map((r) => r.letter));
  // The page gets letters and questions only: no model names, costs or what a question is based on.
  send(res, 200, { sessionId, sets: placed.map((r) => (r.ok
    ? { letter: r.letter, ok: true, questions: r.questions.map(({ type, question, points }) => ({ type, question, points })) }
    : { letter: r.letter, ok: false })) });
}

async function rate(req, res) {
  const b = await readBody(req);
  const letters = openSessions.get(b.sessionId);
  if (!letters) throw fail(400, "This session is unknown or already saved. Start again from Setup.");
  const valid = (v) => Number.isInteger(v) && v >= 1 && v <= 5;
  const ratings = {};
  for (const L of letters) {
    const r = b.ratings?.[L] || {};
    if (![r.q4, r.q5, r.guidance].every(valid)) throw fail(400, `Set ${L} is not fully rated.`);
    const flags = (Array.isArray(r.flags) ? r.flags : []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
    ratings[L] = { q4: r.q4, q5: r.q5, guidance: r.guidance, flags: [...new Set(flags)].sort() };
  }
  await save({ type: "rated", sessionId: b.sessionId, at: new Date().toISOString(), ratings,
               comment: String(b.comment || "").slice(0, 2000) });
  openSessions.delete(b.sessionId);
  send(res, 200, { ok: true });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/status") return status(res);
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
  if (!MOCK) {
    for (const [provider, key] of Object.entries(KEY_NAMES)) {
      if (!process.env[key]) console.log(`  ${key} is missing in .env: the ${provider} models will fail.`);
    }
  }
});
