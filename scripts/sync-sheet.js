// Sends to the team's Google Sheet what this computer has and the sheet doesn't: rated interviews (for example after
// a network problem), and emails left on the end screen that could not be sent. The sheet adds nothing twice, so
// running this again is harmless.
//   npm run sync-sheet                     send what is missing
//   npm run sync-sheet -- --test           check that the sheet answers, its script version, and what it holds
//   npm run sync-sheet -- --all            send every interview again: the sheet adds none twice, but fills in the
//                                          answers about paying that an older script left out
//   npm run sync-sheet -- --include-mock   also send mock sessions (marked MOCK in the sheet, left out of its Summary)
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "../lib/env.js";
import { sheetConnected, post, pushSession, pushContact, EXPECTED_SCRIPT_VERSION } from "../lib/sheet.js";

loadEnv();
const args = process.argv.slice(2);
const RESULTS = path.join(ROOT, "results", "sessions.jsonl");
const UNSENT_CONTACTS = path.join(ROOT, "results", "contacts-unsent.jsonl");
const REDEPLOY = "paste sheet/apps-script.gs into the sheet's Apps Script, save, and redeploy it " +
  "(Deploy → Manage deployments → pencil → Version: New version → Deploy)";

if (!sheetConnected()) {
  console.error("The team sheet is not set up yet: TEAM_SHEET_URL in lib/sheet.js is empty (see the README).");
  process.exit(1);
}

async function ping() {
  try {
    return await post({ type: "ping" });
  } catch (e) {
    console.error(`The sheet does not answer: ${e.message}`);
    process.exit(1);
  }
}
const isCurrent = (r) => r.version >= EXPECTED_SCRIPT_VERSION;

if (args.includes("--test")) {
  const r = await ping();
  console.log(`The sheet answers: "${r.sheet}", script version ${r.version ?? "1 or 2 (before version numbers)"}.`);
  if (isCurrent(r)) {
    console.log(`It holds ${r.interviews} interview(s), ${r.withPayingAnswers} with answers about paying (practice runs not counted).`);
  } else {
    console.log(`This app expects version ${EXPECTED_SCRIPT_VERSION}: ${REDEPLOY}.`);
  }
  process.exit(0);
}

// Emails left on the end screen that did not reach the sheet: send them, and keep only those that fail again.
if (existsSync(UNSENT_CONTACTS)) {
  const waiting = new Map();   // email -> date
  for (const line of readFileSync(UNSENT_CONTACTS, "utf8").split("\n").filter(Boolean)) {
    const c = JSON.parse(line);
    if (!waiting.has(c.email)) waiting.set(c.email, c.date);
  }
  const failed = [];
  for (const [email, date] of waiting) {
    const r = await pushContact(email, date);
    if (!r.ok) failed.push({ date, email, error: r.error });
  }
  if (failed.length) writeFileSync(UNSENT_CONTACTS, failed.map(({ date, email }) => JSON.stringify({ date, email }) + "\n").join(""));
  else unlinkSync(UNSENT_CONTACTS);
  console.log(`Emails: ${waiting.size - failed.length} of ${waiting.size} sent to the Contacts tab` +
    (failed.length ? `; ${failed.length} kept for the next run (${failed[0].error}).` : "."));
}

if (!existsSync(RESULTS)) {
  console.log("No interviews on this computer yet.");
  process.exit(0);
}

const lines = readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const generated = new Map(lines.filter((r) => r.type === "generated" && r.interview).map((r) => [r.sessionId, r]));
const sent = new Set(lines.filter((r) => r.type === "sheet" && r.ok).map((r) => r.sessionId));
const all = args.includes("--all");
if (all && !isCurrent(await ping())) {
  console.error(`--all needs script version ${EXPECTED_SCRIPT_VERSION} in the sheet: ${REDEPLOY}.`);
  process.exit(1);
}
const todo = lines.filter((r) => r.type === "rated" && generated.has(r.sessionId) && (all || !sent.has(r.sessionId))
  && (args.includes("--include-mock") || !generated.get(r.sessionId).mock));
if (!todo.length) {
  console.log("Nothing to send: the sheet has every rated interview from this computer.");
  process.exit(0);
}

let ok = 0;
for (const rated of todo) {
  const rec = await pushSession(generated.get(rated.sessionId), rated);
  appendFileSync(RESULTS, JSON.stringify(rec) + "\n");
  const what = !rec.ok ? `NOT sent: ${rec.error}` : rec.filled ? "the sheet had it; answers about paying added"
    : rec.duplicate ? "the sheet already had it" : "sent";
  console.log(`${rated.sessionId.slice(0, 8)}${rec.participant ? ` (${rec.participant})` : ""}: ${what}`);
  if (rec.ok) ok++;
}
console.log(`${ok} of ${todo.length} done.`);
