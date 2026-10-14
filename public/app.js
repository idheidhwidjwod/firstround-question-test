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

async function initSetup() {
  const keys = $("#keys");
  try {
    const st = await api("/api/status");
    const words = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
    document.querySelectorAll(".n-models").forEach((n) => (n.textContent = words[st.models] || String(st.models)));
    if (st.ladder === "claude") {
      $("#wait-time").textContent = "up to 3 minutes (the extra-high effort model thinks longest)";
      $("#mode-badge").textContent = "Claude models";
    }
    if (st.mock) {
      keys.append(el("p", { class: "note" }, "Mock mode: no AI is called and the questions are placeholders. Mock sessions stay out of the report."));
      $("#mode-badge").textContent = "Mock mode";
      $("#mode-badge").classList.add("mock");
    } else if (st.ladder === "claude") {
      const c = st.claude || {};
      const list = el("ul", { class: "keys" });
      if (!c.found) list.append(el("li", { class: "off" }, "The claude command was not found: install Claude Code and log in"));
      else if (c.auth === "logged out") list.append(el("li", { class: "off" }, "claude is logged out: run claude auth login in a terminal"));
      else list.append(el("li", {}, c.auth === "api key"
        ? `claude ${c.version}, with the API key in .env`
        : `claude ${c.version}, with your Claude login${c.plan ? ` (${c.plan} plan)` : ""}`));
      list.append(el("li", {}, "Your CLAUDE.md, memory, skills, plugins and connectors are switched off for these runs"));
      keys.append(list);
    } else {
      const list = el("ul", { class: "keys" });
      list.append(el("li", { class: st.keys.gemini ? "" : "off" }, st.keys.gemini ? "Gemini key found" : "Gemini key missing in .env: 3 sets will fail"));
      list.append(el("li", { class: st.keys.groq ? "" : "off" }, st.keys.groq ? "Groq key found" : "Groq key missing in .env: 1 set will fail"));
      keys.append(list);
    }
    const sheet = { on: ["", "Results are also copied to the team's Google Sheet"],
      mock: ["", "Mock sessions are not sent to the Google Sheet"],
      off: ["off", "The team's Google Sheet is not set up yet: results stay on this computer"] }[st.sheet];
    if (sheet) keys.append(el("ul", { class: "keys" }, el("li", { class: sheet[0] }, sheet[1])));
  } catch {
    keys.append(el("p", { class: "error" }, "The server is not answering. Is npm start still running?"));
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

$("#load-sample").addEventListener("click", async () => {
  const [cv, ad] = await Promise.all(["cv-sample.txt", "job-ad-sample.txt"].map((f) => fetch(`/samples/${f}`).then((r) => r.text())));
  $("#cv").value = cv;
  $("#jobad").value = ad;
  checkSetup();
});

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
    el("div", { class: "q-head" }, el("span", { class: "qn" }, `Q${q.position}`),
      el("span", { class: `pill ${q.type}` }, q.type === "tailored" ? "Tailored to the CV" : "Standard")),
    el("p", { class: "q-text" }, q.question),
    el("div", { class: "guide" },
      el("h4", {}, "What the interviewer wants to hear"), list(q.wants),
      el("h4", {}, "How that relates to your experience"), list(q.experience)),
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
