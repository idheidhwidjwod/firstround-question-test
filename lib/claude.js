// Runs a Claude model through the Claude Code command (`claude -p`) with the user's own Claude login, set up to
// behave as close as possible to a plain API call, and to cost as little as possible:
// - our system prompt replaces Claude Code's long one, and there are no tools, so a run is one plain answer;
// - nothing personal is loaded: no CLAUDE.md, memory, skills, plugins, hooks, MCP connectors, agents, output styles
//   or settings files, and the command starts in an empty folder with a clean environment;
// - prompt caching is off (a one-off prompt would only pay the cache-write premium);
// - nothing is saved to disk, so the CV never lands in ~/.claude.
// What a Claude login still adds to every request: an "Agent SDK" identity line, a short environment
// description, today's date and the account's email address (about 400 tokens). With ANTHROPIC_API_KEY in .env
// the command runs with --bare and that key instead, and the account email disappears too.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApiError } from "./errors.js";

const WORKDIR = process.platform === "win32" ? path.join(os.tmpdir(), "firstround-claude") : "/tmp/firstround-claude";
const BIN = process.env.CLAUDE_BIN || "claude";

// Only what the command needs to find itself and the login. Variables set by a Claude desktop or terminal session
// (default effort, account email, proxies, entry point) are left out on purpose.
const KEEP = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL",
  "SystemRoot", "APPDATA", "LOCALAPPDATA", "USERPROFILE"];

export const usesApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

function cleanEnv() {
  const env = Object.fromEntries(KEEP.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  env.DISABLE_PROMPT_CACHING = "1";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  if (usesApiKey()) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  return env;
}

export function claudeArgs(m, system) {
  return [
    "-p",
    "--model", m.model,
    ...(m.effort ? ["--effort", m.effort] : []),
    "--system-prompt", system,
    "--tools", "",
    "--safe-mode",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--no-session-persistence",
    "--no-chrome",
    "--prompt-suggestions", "false",
    "--permission-mode", "default",
    "--output-format", "json",
    ...(usesApiKey() ? ["--bare"] : []),
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
      reject(new ApiError(e.code === "ENOENT" ? "the claude command was not found: install Claude Code and log in" : e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.stdin.end(input);
  });
}

// The question prompt goes in through stdin, so the CV never appears in the list of running processes.
export async function callClaude(m, system, user, timeoutMs) {
  const { code, out, err } = await run(claudeArgs(m, system), user, timeoutMs);
  let d;
  try {
    d = JSON.parse(out);
  } catch {
    const last = err.trim().split("\n").filter((l) => !l.includes("unrecognized_model")).pop();
    throw new ApiError(last || `claude stopped with code ${code}`);
  }
  if (d.is_error) throw new ApiError(String(d.result || d.subtype || "claude reported an error"));
  const u = d.usage || {};
  const thinking = u.output_tokens_details?.thinking_tokens ?? 0;   // output_tokens includes thinking
  return {
    text: d.result || "",
    finish: d.stop_reason || d.subtype || "",
    usage: { input: u.input_tokens || 0, output: Math.max(0, (u.output_tokens || 0) - thinking), thinking,
             thinkingEstimated: false, cacheWrite: u.cache_creation_input_tokens || 0,
             cacheRead: u.cache_read_input_tokens || 0 },
    extra: { cliCostUSD: d.total_cost_usd, apiMs: d.duration_api_ms, turns: d.num_turns },
  };
}

// For the status panel: is the command there, and how will it sign in? (No email or account id is returned.)
export async function claudeStatus() {
  try {
    const v = await run(["--version"], "", 20000);
    const version = v.out.trim().split(/\s/)[0] || null;
    if (usesApiKey()) return { found: Boolean(version), version, auth: "api key" };
    const a = await run(["auth", "status"], "", 20000);
    const s = JSON.parse(a.out);
    return { found: Boolean(version), version, auth: s.loggedIn ? "account" : "logged out", plan: s.subscriptionType || null };
  } catch {
    return { found: false, version: null, auth: null };
  }
}
