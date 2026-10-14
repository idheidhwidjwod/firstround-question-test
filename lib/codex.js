// Runs an OpenAI model through the Codex command (`codex exec`) with the user's own ChatGPT login, set up to behave
// as close as possible to a plain API call, and to cost as little as possible:
// - our system prompt replaces Codex's built-in instructions (model_instructions_file);
// - nothing personal is loaded: no config.toml (personality, plugins, MCP servers, default model), no rules files,
//   no AGENTS.md, no memories, no apps, no web search, no shell tool, no sub-agents;
// - a read-only sandbox in an empty folder, a clean environment, and nothing saved (--ephemeral);
// - the question prompt goes in through stdin, so the CV never appears in the list of running processes.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApiError } from "./errors.js";

const WORKDIR = process.platform === "win32" ? path.join(os.tmpdir(), "firstround-codex") : "/tmp/firstround-codex";
const BIN = process.env.CODEX_BIN || "codex";
// Only what the command needs to find itself and the login (CODEX_HOME holds it, if set). API keys are left out on
// purpose, so the ChatGPT login is used.
const KEEP = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "CODEX_HOME",
  "SystemRoot", "APPDATA", "LOCALAPPDATA", "USERPROFILE"];

const cleanEnv = () => Object.fromEntries(KEEP.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

export function codexArgs(m, instructionsFile) {
  const c = (setting) => ["-c", setting];   // -c values are TOML: strings in quotes
  return [
    "exec", "-", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
    "--sandbox", "read-only", "--cd", WORKDIR, "-m", m.model,
    ...(m.effort ? c(`model_reasoning_effort="${m.effort}"`) : []),
    ...c(`model_instructions_file=${JSON.stringify(instructionsFile)}`),
    ...c('web_search="disabled"'),
    ...c('personality="none"'),
    ...c("project_doc_max_bytes=0"),
    ...c("features.memories=false"), ...c("memories.use_memories=false"), ...c("memories.generate_memories=false"),
    ...c("features.apps=false"), ...c("features.multi_agent=false"), ...c("features.shell_tool=false"),
    // Measured on Codex 0.162 with a one-line prompt: 7,334 input tokens without the next lines, 4,740 with them.
    // What remains is Codex's own harness (its sub-agent and code-mode tools cannot be switched off).
    ...c("features.remote_plugin=false"), ...c("skills.max_context_tokens=1"), ...c("features.goals=false"),
    ...c("tools.view_image=false"), ...c("features.unified_exec=false"), ...c("features.sleep_tool=false"),
    ...c("features.skill_mcp_dependency_install=false"),
    ...c("features.fast_mode=false"), ...c("features.ultrafast_mode=false"),   // standard speed, like a plain API call
    ...c("hide_agent_reasoning=true"),
  ];
}

function run(args, input, timeoutMs) {
  mkdirSync(WORKDIR, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { cwd: WORKDIR, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Object.assign(new Error(`no answer within ${timeoutMs / 1000} s`), { name: "TimeoutError" }));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new ApiError(e.code === "ENOENT" ? "the codex command was not found: install Codex and log in" : e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.stdin.end(input);
  });
}

// Reads `codex exec --json` events: the final answer (agent_message) and the usage of the turn.
export function readEvents(jsonl) {
  let text = "", usage = null, error = null;
  for (const line of jsonl.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "item.completed" && e.item?.type === "agent_message") text = e.item.text || text;
    if (e.type === "turn.completed") usage = e.usage || usage;
    if (e.type === "turn.failed") error = e.error?.message || "the turn failed";
    if (e.type === "error") error = e.message || error;
  }
  return { text, usage, error };
}

export async function callCodex(m, system, user, timeoutMs) {
  mkdirSync(WORKDIR, { recursive: true });
  const instructions = path.join(WORKDIR, "instructions.md");
  writeFileSync(instructions, system);
  const { code, out, err } = await run(codexArgs(m, instructions), user, timeoutMs);
  const { text, usage, error } = readEvents(out);
  if (!usage) throw new ApiError(error || err.trim().split("\n").pop() || `codex stopped with code ${code}`);
  // OpenAI counts cached input inside input_tokens, and reasoning inside output_tokens (checked below, in case not).
  const cached = usage.cached_input_tokens || 0;
  const output = usage.output_tokens || 0;
  const thinking = usage.reasoning_output_tokens || 0;
  return {
    text,
    finish: error ? "failed" : "completed",
    usage: { input: Math.max(0, (usage.input_tokens || 0) - cached), cacheRead: cached, cacheWrite: 0,
             output: thinking <= output ? output - thinking : output, thinking, thinkingEstimated: false },
  };
}

// For the status panel: is the command there, and is it logged in? (No email or account id is returned.)
export async function codexStatus() {
  try {
    const v = await run(["--version"], "", 20000);
    const version = (v.out.match(/\d+\.\d+\.\d+\S*/) || [null])[0];
    const a = await run(["login", "status"], "", 20000);
    const said = `${a.out} ${a.err}`;
    const auth = a.code !== 0 ? "logged out" : /api key/i.test(said) ? "api key" : "account";
    return { found: Boolean(version), version, auth, plan: null };
  } catch {
    return { found: false, version: null, auth: null };
  }
}
