// Sends to the team's Google Sheet every rated interview on this computer that the sheet does not have yet,
// for example after a network problem. The sheet adds an interview only once, so running this twice is harmless.
//   npm run sync-sheet                     send what is missing
//   npm run sync-sheet -- --test           only check that the sheet answers
//   npm run sync-sheet -- --include-mock   also send mock sessions (marked MOCK in the sheet, left out of its Summary)
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "../lib/env.js";
import { sheetConnected, post, pushSession } from "../lib/sheet.js";

loadEnv();
const args = process.argv.slice(2);
const RESULTS = path.join(ROOT, "results", "sessions.jsonl");

if (!sheetConnected()) {
  console.error("The team sheet is not set up yet: TEAM_SHEET_URL in lib/sheet.js is empty (see the README).");
  process.exit(1);
}
if (args.includes("--test")) {
  try {
    const r = await post({ type: "ping" });
    console.log(`The sheet answers: "${r.sheet}".`);
  } catch (e) {
    console.error(`The sheet does not answer: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}
if (!existsSync(RESULTS)) {
  console.log("No sessions on this computer yet.");
  process.exit(0);
}

const lines = readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const generated = new Map(lines.filter((r) => r.type === "generated" && r.interview).map((r) => [r.sessionId, r]));
const sent = new Set(lines.filter((r) => r.type === "sheet" && r.ok).map((r) => r.sessionId));
const todo = lines.filter((r) => r.type === "rated" && generated.has(r.sessionId) && !sent.has(r.sessionId)
  && (args.includes("--include-mock") || !generated.get(r.sessionId).mock));
if (!todo.length) {
  console.log("Nothing to send: the sheet has every rated interview from this computer.");
  process.exit(0);
}

let ok = 0;
for (const rated of todo) {
  const rec = await pushSession(generated.get(rated.sessionId), rated);
  appendFileSync(RESULTS, JSON.stringify(rec) + "\n");
  console.log(rec.ok ? `sent ${rated.sessionId.slice(0, 8)}${rec.duplicate ? " (the sheet already had it)" : ""}`
    : `NOT sent ${rated.sessionId.slice(0, 8)}: ${rec.error}`);
  if (rec.ok) ok++;
}
console.log(`${ok} of ${todo.length} sent.`);
