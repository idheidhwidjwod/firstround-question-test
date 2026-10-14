// The Claude or ChatGPT version in the terminal: runs the five set-ups once on a CV and a job ad, with your own login
// and your personal setup switched off (see lib/claude.js and lib/codex.js), then prints each model's questions,
// tokens, cost and time. Nothing is saved.
//   npm run try-claude    or   npm run try-chatgpt              the fictional sample CV and job ad
//   npm run try-claude -- cv.txt job-ad.txt                   your own text files (anonymise the CV first)
//   npm run try-claude -- --full                              also the notes under every question
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "../lib/env.js";
import { LADDERS, USD_CHF, runAll } from "../lib/models.js";
import { claudeStatus } from "../lib/claude.js";
import { codexStatus } from "../lib/codex.js";

loadEnv();
const TOOLS = {
  claude: { cmd: "claude", account: "Claude", product: "Claude Code", login: "claude auth login", status: claudeStatus,
            off: "CLAUDE.md, memory, skills, plugins, connectors and settings switched off" },
  chatgpt: { cmd: "codex", account: "ChatGPT", product: "Codex", login: "codex login", status: codexStatus,
             off: "config, rules, AGENTS.md, memories, plugins, apps and web search switched off" },
};
const [ladder, ...rest] = process.argv.slice(2);
const tool = TOOLS[ladder] || (ladder?.startsWith("chatgpt") && LADDERS[ladder] ? TOOLS.chatgpt : null);
if (!tool) {
  console.error("Usage: node scripts/try.js claude|chatgpt|chatgpt-free [cv.txt job-ad.txt] [--full]");
  process.exit(1);
}
const full = rest.includes("--full");
const [cvFile = path.join(ROOT, "samples", "cv-sample.txt"), adFile = path.join(ROOT, "samples", "job-ad-sample.txt")] =
  rest.filter((a) => !a.startsWith("--"));
const cv = readFileSync(cvFile, "utf8");
const jobAd = readFileSync(adFile, "utf8");
const models = LADDERS[ladder];

const st = await tool.status();
if (!st.found) {
  console.error(`The ${tool.cmd} command was not found. Install ${tool.product} (see SETUP.md), then run: ${tool.login}`);
  process.exit(1);
}
if (st.auth === "logged out") {
  console.error(`${tool.cmd} is logged out. Run: ${tool.login}`);
  process.exit(1);
}
console.log(`${tool.cmd} ${st.version} · ${st.auth === "api key" ? "an API key" : `your ${tool.account} login${st.plan ? ` (${st.plan})` : ""}`} · ${tool.off}`);
console.log(`${models.length} models at once on ${path.basename(cvFile)} + ${path.basename(adFile)}. The slowest can take a few minutes…\n`);

const t0 = Date.now();
const runs = await runAll(cv, jobAd, { ladder });

runs.forEach((r, i) => {
  console.log(`━━ ${models[i].label}   (${r.model}${r.effort ? `, effort ${r.effort}` : ""})`);
  if (!r.ok) {
    console.log(`   FAILED: ${r.error}\n`);
    return;
  }
  r.questions.forEach((q, k) => {
    console.log(`   Q${k + 1}: ${q.question}`);
    if (full) {
      console.log("        What the interviewer wants to hear:");
      for (const w of q.wants) console.log(`          · ${w}`);
      console.log("        Practical tips:");
      for (const t of q.tips) console.log(`          · ${t}`);
    }
  });
  if (r.warnings.length) console.log(`   Warnings: ${r.warnings.join("; ")}`);
  console.log("");
});

const cols = [["Model", 35], ["Tokens in / out / thinking", 28], ["Cost, list price", 26], ["Time", 8]];
const line = (cells) => cells.map((c, i) => String(c).padEnd(cols[i][1])).join("");
console.log(line(cols.map((c) => c[0])));
let total = 0;
runs.forEach((r, i) => {
  total += r.costUSD;
  const u = r.usage;
  const input = u.input + (u.cacheRead || 0);
  console.log(line([models[i].label, `${input} / ${u.output} / ${u.thinking}`,
    `$${r.costUSD.toFixed(4)} (CHF ${(r.costUSD * USD_CHF).toFixed(4)})`, `${(r.ms / 1000).toFixed(1)} s`]));
});
console.log(`\nAll ${models.length}: $${total.toFixed(4)} at API list prices, ${((Date.now() - t0) / 1000).toFixed(0)} s.` +
  ` Input includes the tokens the ${tool.cmd} command adds to our prompt (see the README).`);
console.log(`With a ${tool.account} plan these runs use your plan's allowance; nothing is billed per token.`);
