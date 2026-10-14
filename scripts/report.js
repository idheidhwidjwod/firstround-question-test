// The results per model and the decision against the criteria set before the test (Build-to-Learn card).
// Each session is one interview mixing the models (question n from one model); every question gets a relevance
// score from 1 to 5. The primary metric uses the tailored questions: since 14 Oct every question is tailored; the
// first design also had 3 standard questions, which are left out. One table per ladder found in the files.
//   npm run report                                  this computer's sessions (results/sessions.jsonl)
//   npm run report -- results/sessions.jsonl other.jsonl   several computers' files together
// Participant numbers restart at P1 on every computer, so a person is a (file, number) pair.
//   npm run report -- --include-mock                keep mock sessions (to try the report)
// Prints Markdown and writes it to results/report.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LADDERS, USD_CHF, costUSD } from "../lib/models.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const includeMock = args.includes("--include-mock");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) files.push(path.join(ROOT, "results", "sessions.jsonl"));

// Desk estimate of 13 Oct (deck annex) for question generation alone: 2,300 tokens in, 200 out, assumed thinking.
const ESTIMATE = { input: 2300, output: 200, thinking: { "flash-lite": 0, "gpt-oss-20b": 300, flash: 1000, pro: 1500 } };

const generated = new Map();
const rated = new Map();
let oldFormat = 0;
for (const [fileIndex, f] of files.entries()) {
  if (!existsSync(f)) {
    if (args.some((a) => !a.startsWith("--"))) console.error(`No such file: ${f}`);   // the default file appears with the first session
    continue;
  }
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.type === "generated" && (includeMock || !r.mock)) {
      if (!r.interview) { oldFormat++; continue; }   // sessions from the first version (five separate sets)
      generated.set(r.sessionId, { ladder: "gemini", ...r, fileIndex });
    }
    if (r.type === "rated") rated.set(r.sessionId, r);
  }
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const share45 = (xs) => (xs.length ? xs.filter((v) => v >= 4).length / xs.length : null);
const pct = (xs) => (xs.length ? `${Math.round(100 * share45(xs))}% (${xs.filter((v) => v >= 4).length}/${xs.length})` : "–");
const num = (x, d = 1) => (x == null ? "–" : x.toFixed(d));
const int = (x) => (x == null ? "–" : Math.round(x).toLocaleString("en-US"));
const usd = (x) => (x == null ? "–" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

function ladderReport(ladder) {
  const models = LADDERS[ladder];
  const sessions = [...generated.values()].filter((g) => g.ladder === ladder);
  const per = Object.fromEntries(models.map((m) => [m.id, { m, runs: [], tailored: [] }]));
  for (const g of sessions) for (const run of g.runs) if (!run.configError) per[run.modelId]?.runs.push(run);

  const ratedSessions = sessions.filter((g) => rated.has(g.sessionId));
  for (const g of ratedSessions) {
    const ratings = rated.get(g.sessionId).ratings;
    for (const slot of g.interview) {
      const v = ratings[slot.position];
      const p = per[slot.modelId];
      const q = g.runs.find((r) => r.modelId === slot.modelId)?.questions?.[slot.index];
      if (!v || !p || (q?.type ?? (slot.position >= 4 ? "tailored" : "standard")) !== "tailored") continue;
      p.tailored.push(v);
    }
  }
  const people = new Map();
  for (const g of ratedSessions) {
    people.set(`${g.fileIndex}|${rated.get(g.sessionId).participant || g.participant.code}`, g.participant.kind);
  }
  const kinds = [...people.values()];

  const rows = [
    ["Questions rated 4 or 5 for relevance (primary metric)", (p) => pct(p.tailored)],
    ["Mean relevance (1–5)", (p) => num(avg(p.tailored))],
    ["Runs that worked (each run writes a full interview)", (p) => `${p.runs.filter((r) => r.ok).length}/${p.runs.length}`],
    ["Tokens per run: input / output / thinking", (p) => {
      const u = (k) => avg(p.runs.map((r) => r.usage[k]));
      const est = p.runs.some((r) => r.usage.thinkingEstimated) ? " (thinking estimated)" : "";
      return p.runs.length ? `${int(u("input"))} / ${int(u("output"))} / ${int(u("thinking"))}${est}` : "–";
    }],
    ["Cost per run, list price (the 5 questions only)", (p) => {
      const c = avg(p.runs.map((r) => r.costUSD));
      return c == null ? "–" : `${usd(c)} (CHF ${(c * USD_CHF).toFixed(4)})`;
    }],
    ...(ladder === "gemini" ? [["Desk estimate of 13 Oct, same scope", (p) => usd(costUSD(p.m, { input: ESTIMATE.input,
      output: ESTIMATE.output, thinking: ESTIMATE.thinking[p.m.id] }))]] : []),
    ["Time per run", (p) => { const ms = avg(p.runs.map((r) => r.ms)); return ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`; }],
  ];

  const cheap = models.filter((m) => m.role === "cheap");
  const premiumModel = models.find((m) => m.role === "premium");
  const premium = share45(per[premiumModel.id].tailored);
  const cheapShares = cheap.map((m) => share45(per[m.id].tailored));
  const cheapNames = cheap.map((m) => m.label).join(" or ");
  let decision;
  if (people.size < 8) {
    decision = `**Inconclusive**: ${people.size} ${people.size === 1 ? "person" : "people"} rated; the criteria need at least 8.`;
  } else if (cheapShares.some((x) => x != null && x >= 0.7 && premium != null && premium - x <= 0.1)) {
    decision = `**Success**: ${cheapNames} reaches 70%, within 10 points of ${premiumModel.label}.`;
  } else if (Math.max(...cheapShares.map((x) => x ?? 0)) < 0.5) {
    decision = `**Failure**: ${cheapNames} stays under 50%. Pay for a better model.`;
  } else {
    decision = `**Inconclusive**: ${cheapNames} is between 50% and 69%, or more than 10 points behind ${premiumModel.label}.`;
  }

  const failed = sessions.flatMap((g) => g.runs.filter((r) => !r.ok && !r.configError)
    .map((r) => `${r.model}${r.effort ? ` (${r.effort})` : ""}: ${r.error}`));
  const comments = ratedSessions.map((g) => rated.get(g.sessionId).comment).filter(Boolean);
  const title = { claude: "Claude models (claude command, own login)", chatgpt: "ChatGPT models, paid plans (codex command, own login)",
    "chatgpt-free": "ChatGPT models, Free and Go plans (codex command, own login)" }[ladder]
    || "Free and low-cost API models";

  return [
    `## ${title}`,
    "",
    `People who rated: **${people.size}** (${kinds.filter((k) => k === "job seeker").length} looking for a job, ` +
      `${kinds.filter((k) => k === "in a job").length} in a job) · rated interviews: ${ratedSessions.length} · all: ${sessions.length}`,
    "",
    `| | ${models.map((m) => `${m.tier}: ${m.label}`).join(" | ")} |`,
    `|---|${models.map(() => "---").join("|")}|`,
    ...rows.map(([label, f]) => `| ${label} | ${models.map((m) => f(per[m.id])).join(" | ")} |`),
    "",
    `Decision (criteria set before the test): ${decision}`,
    ...(failed.length ? ["", "Runs that failed:", ...failed.map((x) => `- ${x}`)] : []),
    ...(comments.length ? ["", "Comments:", ...comments.map((c) => `- ${c.replace(/\s+/g, " ")}`)] : []),
    "",
  ].join("\n");
}

const ladders = Object.keys(LADDERS).filter((l) => [...generated.values()].some((g) => g.ladder === l));
const md = [
  "# Question test: results",
  "",
  `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${files.map((f) => path.relative(ROOT, f) || f).join(", ")}` +
    `${includeMock ? " · **mock sessions included**" : ""}` +
    `${oldFormat ? ` · ${oldFormat} session(s) from the first version (separate sets) left out` : ""}`,
  "",
  ...(ladders.length ? ladders.map(ladderReport) : ["No sessions yet.", ""]),
  "Criteria: success if a cheap model has ≥ 70% of its questions rated 4–5 for relevance, within 10 points of the " +
    "premium model; failure if every cheap model is under 50%; otherwise, or with fewer than 8 people, inconclusive. " +
    "Each interview gives every model one question, so 8 people give each model about 8 ratings.",
  "",
].join("\n");

mkdirSync(path.join(ROOT, "results"), { recursive: true });
writeFileSync(path.join(ROOT, "results", "report.md"), md);
console.log(md);
