// The results per model and the decision against the criteria set before the test (Build-to-Learn card).
//   npm run report                                  this computer's sessions (results/sessions.jsonl)
//   npm run report -- results/sessions.jsonl other.jsonl   several facilitators' files together
//   npm run report -- --include-mock                keep mock sessions (to try the report)
// Prints Markdown and writes it to results/report.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS, USD_CHF, costUSD } from "../lib/models.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const includeMock = args.includes("--include-mock");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) files.push(path.join(ROOT, "results", "sessions.jsonl"));

// Desk estimate of 13 Oct (deck annex) for question generation alone: 2,300 tokens in, 200 out, assumed thinking.
const ESTIMATE = { input: 2300, output: 200, thinking: { "flash-lite": 0, "gpt-oss-20b": 300, flash: 1000, pro: 1500 } };

const generated = new Map();
const rated = new Map();
for (const f of files) {
  if (!existsSync(f)) { console.error(`No such file: ${f}`); continue; }
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.type === "generated" && (includeMock || !r.mock)) generated.set(r.sessionId, r);
    if (r.type === "rated") rated.set(r.sessionId, r);
  }
}

const per = Object.fromEntries(MODELS.map((m) => [m.id, { m, runs: [], tailored: [], guidance: [], flags: 0, shown: 0 }]));
for (const g of generated.values()) for (const run of g.runs) if (!run.configError) per[run.modelId]?.runs.push(run);

const ratedSessions = [...generated.values()].filter((g) => rated.has(g.sessionId));
for (const g of ratedSessions) {
  const ratings = rated.get(g.sessionId).ratings;
  for (const run of g.runs) {
    const r = ratings[run.letter];
    if (!run.ok || !r) continue;
    const p = per[run.modelId];
    p.tailored.push(r.q4, r.q5);
    p.guidance.push(r.guidance);
    p.flags += r.flags.length;
    p.shown += 5;
  }
}

const people = new Map();
for (const g of ratedSessions) people.set(`${g.participant.facilitator}|${g.participant.code}`, g.participant.kind);
const kinds = [...people.values()];

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const share45 = (p) => (p.tailored.length ? p.tailored.filter((v) => v >= 4).length / p.tailored.length : null);
const pct = (x) => (x == null ? "–" : `${Math.round(100 * x)}%`);
const num = (x, d = 1) => (x == null ? "–" : x.toFixed(d));
const int = (x) => (x == null ? "–" : Math.round(x).toLocaleString("en-US"));
const usd = (x) => (x == null ? "–" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

const rows = [
  ["Tailored questions rated 4 or 5 (primary metric)", (p) => p.tailored.length
    ? `${pct(share45(p))} (${p.tailored.filter((v) => v >= 4).length}/${p.tailored.length})` : "–"],
  ["Mean relevance of tailored questions (1–5)", (p) => num(avg(p.tailored))],
  ["Answer guidance, mean usefulness (1–5)", (p) => num(avg(p.guidance))],
  ["Questions flagged wrong, invented or inappropriate", (p) => (p.shown ? `${p.flags} of ${p.shown}` : "–")],
  ["Runs that worked", (p) => `${p.runs.filter((r) => r.ok).length}/${p.runs.length}`],
  ["Tokens per run: input / output / thinking", (p) => {
    const u = (k) => avg(p.runs.map((r) => r.usage[k]));
    const est = p.runs.some((r) => r.usage.thinkingEstimated) ? " (thinking estimated)" : "";
    return p.runs.length ? `${int(u("input"))} / ${int(u("output"))} / ${int(u("thinking"))}${est}` : "–";
  }],
  ["Cost per run, list price (question generation only)", (p) => {
    const c = avg(p.runs.map((r) => r.costUSD));
    return c == null ? "–" : `${usd(c)} (CHF ${(c * USD_CHF).toFixed(4)})`;
  }],
  ["Desk estimate of 13 Oct, same scope", (p) => usd(costUSD(p.m, { input: ESTIMATE.input, output: ESTIMATE.output,
    thinking: ESTIMATE.thinking[p.m.id] }))],
  ["Time per run", (p) => { const ms = avg(p.runs.map((r) => r.ms)); return ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`; }],
];

const free = share45(per["flash-lite"]);
const cheap = share45(per["gpt-oss-20b"]);
const premium = share45(per.pro);
const closeToPremium = (x) => x != null && premium != null && premium - x <= 0.1;
let decision;
if (people.size < 8) {
  decision = `**Inconclusive**: ${people.size} ${people.size === 1 ? "person" : "people"} rated; the criteria need at least 8.`;
} else if ((free >= 0.7 && closeToPremium(free)) || (cheap >= 0.7 && closeToPremium(cheap))) {
  decision = "**Success**: the free or the cheapest model reaches 70%, within 10 points of premium.";
} else if (Math.max(free ?? 0, cheap ?? 0) < 0.5) {
  decision = "**Failure**: the free and the cheapest model are both under 50%. Pay for a better model.";
} else {
  decision = "**Inconclusive**: the free and the cheapest model are between 50% and 69%, or more than 10 points behind premium.";
}

const flaggedRuns = [...generated.values()].flatMap((g) => g.runs.filter((r) => !r.ok).map((r) => `${r.model}: ${r.error}`));
const comments = ratedSessions.map((g) => rated.get(g.sessionId).comment).filter(Boolean);

const md = [
  "# Question test: results",
  "",
  `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${files.map((f) => path.relative(ROOT, f) || f).join(", ")}` +
    `${includeMock ? " · **mock sessions included**" : ""}`,
  "",
  `People who rated: **${people.size}** (${kinds.filter((k) => k === "job seeker").length} looking for a job, ` +
    `${kinds.filter((k) => k === "in a job").length} in a job) · rated sessions: ${ratedSessions.length} · all sessions: ${generated.size}`,
  "",
  `| | ${MODELS.map((m) => `${m.tier}: ${m.label}`).join(" | ")} |`,
  `|---|${MODELS.map(() => "---").join("|")}|`,
  ...rows.map(([label, f]) => `| ${label} | ${MODELS.map((m) => f(per[m.id])).join(" | ")} |`),
  "",
  `Decision (criteria set before the test): ${decision}`,
  "",
  "Criteria: success if the free or the cheapest model has ≥ 70% of tailored questions rated 4–5, within 10 points of premium; " +
    "failure if both are under 50%; otherwise, or with fewer than 8 people, inconclusive.",
  ...(flaggedRuns.length ? ["", "Runs that failed:", ...flaggedRuns.map((x) => `- ${x}`)] : []),
  ...(comments.length ? ["", "Comments:", ...comments.map((c) => `- ${c.replace(/\s+/g, " ")}`)] : []),
  "",
].join("\n");

mkdirSync(path.join(ROOT, "results"), { recursive: true });
writeFileSync(path.join(ROOT, "results", "report.md"), md);
console.log(md);
