// The Claude version in the terminal: runs the five Claude set-ups once on a CV and a job ad, with your own Claude
// login and your personal setup switched off (see lib/claude.js), then prints each model's questions, tokens,
// cost and time. Nothing is saved.
//   npm run try-claude                         the fictional sample CV and job ad
//   npm run try-claude -- cv.txt job-ad.txt    your own text files (anonymise the CV first)
//   npm run try-claude -- --full               also the 3 standard questions, and the notes under every question
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib/env.js";
import { LADDERS, USD_CHF, runAll } from "../lib/models.js";
import { claudeStatus } from "../lib/claude.js";

loadEnv();

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const full = args.includes("--full");
const [cvFile = path.join(ROOT, "samples", "cv-sample.txt"), adFile = path.join(ROOT, "samples", "job-ad-sample.txt")] =
  args.filter((a) => !a.startsWith("--"));
const cv = readFileSync(cvFile, "utf8");
const jobAd = readFileSync(adFile, "utf8");
const models = LADDERS.claude;

const st = await claudeStatus();
if (!st.found) {
  console.error("The claude command was not found. Install Claude Code, then run: claude auth login");
  process.exit(1);
}
if (st.auth === "logged out") {
  console.error("claude is logged out. Run: claude auth login");
  process.exit(1);
}
console.log(`claude ${st.version} · ${st.auth === "api key" ? "API key from .env (--bare)" : `your Claude login${st.plan ? ` (${st.plan})` : ""}`}` +
  " · CLAUDE.md, memory, skills, plugins, connectors and settings switched off");
console.log(`${models.length} models at once on ${path.basename(cvFile)} + ${path.basename(adFile)}. The slowest can take a few minutes…\n`);

const t0 = Date.now();
const runs = await runAll(cv, jobAd, { ladder: "claude" });

runs.forEach((r, i) => {
  const m = models[i];
  console.log(`━━ ${m.label}   (${r.model}${r.effort ? `, --effort ${r.effort}` : ""})`);
  if (!r.ok) {
    console.log(`   FAILED: ${r.error}\n`);
    return;
  }
  r.questions.forEach((q, k) => {
    if (!full && q.type !== "tailored") return;
    console.log(`   Q${k + 1} ${q.type === "tailored" ? "tailored" : "standard"}: ${q.question}`);
    if (full) {
      console.log("        What the interviewer wants to hear:");
      for (const w of q.wants) console.log(`          · ${w}`);
      console.log("        How that relates to your experience:");
      for (const x of q.experience) console.log(`          · ${x}`);
    }
  });
  if (r.warnings.length) console.log(`   Warnings: ${r.warnings.join("; ")}`);
  console.log("");
});

const cols = [["Model", 30], ["Tokens in / out / thinking", 28], ["Cost, list price", 26], ["Time", 8]];
const line = (cells) => cells.map((c, i) => String(c).padEnd(cols[i][1])).join("");
console.log(line(cols.map((c) => c[0])));
let total = 0;
runs.forEach((r, i) => {
  total += r.costUSD;
  const u = r.usage;
  console.log(line([models[i].label, `${u.input} / ${u.output} / ${u.thinking}`,
    `$${r.costUSD.toFixed(4)} (CHF ${(r.costUSD * USD_CHF).toFixed(4)})`, `${(r.ms / 1000).toFixed(1)} s`]));
});
console.log(`\nAll ${models.length}: $${total.toFixed(4)} at API list prices, ${((Date.now() - t0) / 1000).toFixed(0)} s.` +
  " Input includes ~400 tokens the claude command adds (identity, environment, date, account email).");
console.log("With a Claude plan these runs use your plan's allowance; nothing is billed per token.");
