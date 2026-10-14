// The page: Setup → (loading) → Rate → Done. Model text is always inserted as text, never as HTML.
const $ = (sel) => document.querySelector(sel);
// Participants are numbered by the server (P1, P2… on this computer) and the number is never shown.
const state = { kind: null, sessionId: null, questions: [], ratings: {} };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== "") node.append(c);
  return node;
}

async function api(url, body) {
  const res = await fetch(url, body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function show(view) {
  for (const v of ["setup", "loading", "rate", "done"]) $(`#view-${v}`).hidden = v !== view;
  const order = ["setup", "rate", "done"];
  const current = order.indexOf(view === "loading" ? "setup" : view);
  document.querySelectorAll("#steps li").forEach((li) => {
    const i = order.indexOf(li.dataset.step);
    li.classList.toggle("on", i === current);
    li.classList.toggle("past", i < current);
  });
  window.scrollTo(0, 0);
  $("#main").focus({ preventScroll: true });
}

// ---------------------------------------------------------------- setup

function missingFields() {
  const missing = [];
  if (!state.kind) missing.push("who the participant is");
  if (!$("#consent").checked) missing.push("the consent tick");
  if ($("#jobad").value.trim().length < 200) missing.push("the job ad");
  if ($("#cv").value.trim().length < 200) missing.push("the CV");
  return missing;
}

function checkSetup() {
  const missing = missingFields();
  $("#generate").disabled = missing.length > 0;
  $("#missing").textContent = missing.length ? `Still needed: ${missing.join(", ")}.` : "";
}

// The box above "Write the questions" stays empty unless something needs fixing before a session.
async function initSetup() {
  const keys = $("#keys");
  const warn = (text) => keys.append(el("p", { class: "error" }, text));
  try {
    const st = await api("/api/status");
    const words = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
    document.querySelectorAll(".n-models").forEach((n) => (n.textContent = words[st.models] || String(st.models)));
    const viaCli = st.ladder === "claude" || st.ladder.startsWith("chatgpt");
    if (viaCli) {
      $("#wait-time").textContent = "up to 3 minutes (the extra-high effort model thinks longest)";
      $("#mode-badge").textContent = st.ladder === "claude" ? "Claude models"
        : st.ladder === "chatgpt-free" ? "ChatGPT models, free plan" : "ChatGPT models";
    }
    if (st.mock) {
      $("#mode-badge").textContent = "Mock mode";
      $("#mode-badge").classList.add("mock");
    } else if (viaCli) {
      const c = st.cli || {};
      const [tool, product, login] = st.ladder === "claude"
        ? ["claude", "Claude Code", "claude auth login"] : ["codex", "Codex", "codex login"];
      if (!c.found) warn(`The ${tool} command was not found: install ${product} and log in (see SETUP.md).`);
      else if (c.auth === "logged out") warn(`${tool} is logged out: run ${login} in a terminal, then restart the app.`);
    } else {
      if (!st.keys.gemini) warn("Gemini key missing in .env: 3 of the 4 models will fail.");
      if (!st.keys.groq) warn("Groq key missing in .env: 1 of the 4 models will fail.");
    }
  } catch {
    warn("The server is not answering. Is the app still running in the terminal?");
  }
  checkSetup();
}

document.querySelectorAll("#kind .opt").forEach((opt) => {
  opt.addEventListener("click", () => {
    state.kind = opt.dataset.kind;
    document.querySelectorAll("#kind .opt").forEach((o) => o.setAttribute("aria-checked", String(o === opt)));
    checkSetup();
  });
});
for (const id of ["jobad", "cv"]) $(`#${id}`).addEventListener("input", checkSetup);
$("#consent").addEventListener("change", checkSetup);

$("#generate").addEventListener("click", async () => {
  $("#setup-error").hidden = true;
  show("loading");
  try {
    const data = await api("/api/generate", {
      kind: state.kind, consent: $("#consent").checked, cv: $("#cv").value, jobAd: $("#jobad").value,
    });
    if (!data.questions?.length) throw new Error("No model answered. Check the API keys in .env (or the claude login) and the terminal running the app.");
    state.sessionId = data.sessionId;
    state.questions = data.questions;
    renderRate();
    show("rate");
  } catch (e) {
    show("setup");
    $("#setup-error").textContent = e.message;
    $("#setup-error").hidden = false;
  }
});

// ---------------------------------------------------------------- rating: one interview, a relevance score per question

function scale(position) {
  const id = `rate-${position}`;
  const group = el("div", { class: "scale", role: "radiogroup", "aria-labelledby": id });
  for (let v = 1; v <= 5; v++) {
    const b = el("button", { type: "button", role: "radio", "aria-checked": "false", "aria-label": `${v} out of 5` }, String(v));
    b.addEventListener("click", () => {
      state.ratings[position] = v;
      group.querySelectorAll("button").forEach((x, i) => x.setAttribute("aria-checked", String(i + 1 === v)));
      updateProgress();
    });
    group.append(b);
  }
  return el("div", { class: "rate" }, el("p", { class: "rate-q", id }, "How relevant is this question for this job and this CV?"),
    group, el("div", { class: "scale-ends" }, el("span", {}, "1 · not relevant"), el("span", {}, "5 · I'd expect it in a real interview")));
}

const list = (items) => el("ul", {}, ...items.map((t) => el("li", {}, t)));

function questionCard(q) {
  return el("article", { class: "q" },
    el("div", { class: "q-head" }, el("span", { class: "qn" }, `Q${q.position}`)),
    el("p", { class: "q-text" }, q.question),
    el("div", { class: "guide" },
      el("h4", {}, "What the interviewer wants to hear"), list(q.wants),
      el("h4", {}, "Practical tips"), list(q.tips)),
    scale(q.position));
}

function renderRate() {
  state.ratings = {};
  $("#comment").value = "";
  $("#questions").replaceChildren(...state.questions.map(questionCard));
  updateProgress();
}

function updateProgress() {
  const done = state.questions.filter((q) => state.ratings[q.position]).length;
  $("#rate-progress").textContent = `${done} of ${state.questions.length} questions rated`;
  $("#submit").disabled = done < state.questions.length;
}

$("#submit").addEventListener("click", async () => {
  $("#submit").disabled = true;
  $("#rate-error").hidden = true;
  try {
    const saved = await api("/api/rate", { sessionId: state.sessionId, ratings: state.ratings, comment: $("#comment").value });
    const sheet = saved.sheet || {};
    $("#done-text").textContent = sheet.state === "on" && sheet.ok
      ? "The ratings are saved on this computer and in the team's Google Sheet."
      : sheet.state === "on"
        ? `The ratings are saved on this computer. The copy to the team's Google Sheet failed (${sheet.error}); run npm run sync-sheet to send it later.`
        : "The ratings are saved on this computer.";
    show("done");
  } catch (e) {
    $("#rate-error").textContent = e.message;
    $("#rate-error").hidden = false;
    updateProgress();
  }
});

// ---------------------------------------------------------------- next participant

$("#next").addEventListener("click", () => {
  for (const id of ["cv", "jobad"]) $(`#${id}`).value = "";
  $("#consent").checked = false;
  state.kind = null;
  document.querySelectorAll("#kind .opt").forEach((o) => o.setAttribute("aria-checked", "false"));
  checkSetup();
  show("setup");
});

initSetup();
