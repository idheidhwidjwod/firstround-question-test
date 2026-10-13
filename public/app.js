// The page: Setup → (loading) → Rate → Done. Model text is always inserted as text, never as HTML.
const $ = (sel) => document.querySelector(sel);
const state = { kind: null, sessionId: null, sets: [], ratings: {} };

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

const remember = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window: fine */ } },
};

// ---------------------------------------------------------------- setup

function missingFields() {
  const missing = [];
  if (!/^[A-Z]{1,4}$/i.test($("#facilitator").value.trim())) missing.push("your initials");
  if (!/^P\d{1,3}$/i.test($("#code").value.trim())) missing.push("a participant code like P1");
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
  $("#facilitator").value = remember.get("facilitator");
  const keys = $("#keys");
  try {
    const st = await api("/api/status");
    if (st.mock) {
      keys.append(el("p", { class: "note" }, "Mock mode: no AI is called and the questions are placeholders. Mock sessions stay out of the report."));
      $("#mode-badge").textContent = "Mock mode";
      $("#mode-badge").classList.add("mock");
    } else {
      const list = el("ul", { class: "keys" });
      list.append(el("li", { class: st.keys.gemini ? "" : "off" }, st.keys.gemini ? "Gemini key found" : "Gemini key missing in .env: 3 sets will fail"));
      list.append(el("li", { class: st.keys.groq ? "" : "off" }, st.keys.groq ? "Groq key found" : "Groq key missing in .env: 1 set will fail"));
      keys.append(list);
    }
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
for (const id of ["facilitator", "code", "jobad", "cv"]) $(`#${id}`).addEventListener("input", checkSetup);
$("#consent").addEventListener("change", checkSetup);

$("#load-sample").addEventListener("click", async () => {
  const [cv, ad] = await Promise.all(["cv-sample.txt", "job-ad-sample.txt"].map((f) => fetch(`/samples/${f}`).then((r) => r.text())));
  $("#cv").value = cv;
  $("#jobad").value = ad;
  checkSetup();
});

$("#generate").addEventListener("click", async () => {
  $("#setup-error").hidden = true;
  remember.set("facilitator", $("#facilitator").value.trim().toUpperCase());
  show("loading");
  try {
    const data = await api("/api/generate", {
      facilitator: $("#facilitator").value, code: $("#code").value, kind: state.kind,
      consent: $("#consent").checked, cv: $("#cv").value, jobAd: $("#jobad").value,
    });
    if (!data.sets.some((s) => s.ok)) throw new Error("None of the four models answered. Check the API keys in .env and the terminal running npm start.");
    state.sessionId = data.sessionId;
    state.sets = data.sets;
    renderRate();
    show("rate");
  } catch (e) {
    show("setup");
    $("#setup-error").textContent = e.message;
    $("#setup-error").hidden = false;
  }
});

// ---------------------------------------------------------------- rating

function scale(letter, key, question, [low, high]) {
  const id = `q-${letter}-${key}`;
  const group = el("div", { class: "scale", role: "radiogroup", "aria-labelledby": id });
  for (let v = 1; v <= 5; v++) {
    const b = el("button", { type: "button", role: "radio", "aria-checked": "false", "aria-label": `${v} out of 5` }, String(v));
    b.addEventListener("click", () => {
      state.ratings[letter][key] = v;
      group.querySelectorAll("button").forEach((x, i) => x.setAttribute("aria-checked", String(i + 1 === v)));
      updateProgress();
    });
    group.append(b);
  }
  return el("div", { class: "rate" }, el("p", { class: "rate-q", id }, question), group,
    el("div", { class: "scale-ends" }, el("span", {}, `1 · ${low}`), el("span", {}, `5 · ${high}`)));
}

function flagBox(letter, n) {
  const box = el("input", { type: "checkbox" });
  box.addEventListener("change", () => {
    const flags = new Set(state.ratings[letter].flags);
    if (box.checked) flags.add(n); else flags.delete(n);
    state.ratings[letter].flags = [...flags];
  });
  return el("label", { class: "flag" }, box, "Something here is wrong, invented or inappropriate");
}

function questionCard(letter, q, n) {
  const list = el("ul");
  for (const p of q.points) {
    list.append(el("li", {}, el("b", {}, p.point), p.why ? el("span", { class: "why" }, el("i", {}, "Why"), p.why) : ""));
  }
  return el("article", { class: "q" },
    el("div", { class: "q-head" }, el("span", { class: "qn" }, `Q${n}`),
      el("span", { class: `pill ${q.type}` }, q.type === "tailored" ? "Tailored to the CV" : "Standard")),
    el("p", { class: "q-text" }, q.question),
    el("div", { class: "guide" }, el("h4", {}, "What your answer should contain"), list),
    q.type === "tailored"
      ? scale(letter, `q${n}`, "How relevant is this question for this job and this CV?", ["not relevant", "I'd expect it in a real interview"])
      : "",
    flagBox(letter, n));
}

function select(letter) {
  for (const s of state.sets) {
    $(`#tab-${s.letter}`).setAttribute("aria-selected", String(s.letter === letter));
    $(`#set-${s.letter}`).hidden = s.letter !== letter;
  }
}

function renderRate() {
  const tabs = $("#tabs"), sets = $("#sets");
  tabs.replaceChildren();
  sets.replaceChildren();
  state.ratings = {};
  $("#comment").value = "";
  state.sets.forEach((s, i) => {
    const tab = el("button", { class: `tab${s.ok ? "" : " failed"}`, type: "button", role: "tab", id: `tab-${s.letter}`,
      "aria-controls": `set-${s.letter}`, "aria-selected": "false" }, `Set ${s.letter}`);
    tab.addEventListener("click", () => select(s.letter));
    tabs.append(tab);
    const panel = el("section", { class: "set", id: `set-${s.letter}`, role: "tabpanel", "aria-labelledby": `tab-${s.letter}` });
    if (!s.ok) {
      panel.append(el("div", { class: "panel" }, el("p", {}, "This set could not be written. Skip it: the report shows why.")));
    } else {
      state.ratings[s.letter] = { flags: [] };
      s.questions.forEach((q, k) => panel.append(questionCard(s.letter, q, k + 1)));
      panel.append(el("div", { class: "panel guide-rate" },
        scale(s.letter, "guidance", "Overall, how useful is “What your answer should contain” in this set?", ["not useful", "very useful"])));
    }
    const next = state.sets[i + 1];
    if (next) {
      const go = el("button", { class: "btn ghost small", type: "button" }, `Next: Set ${next.letter} →`);
      go.addEventListener("click", () => { select(next.letter); $("#tabs").scrollIntoView({ block: "start" }); });
      panel.append(el("div", { class: "set-nav" }, go));
    }
    sets.append(panel);
  });
  select(state.sets[0].letter);
  updateProgress();
}

const complete = (letter) => ["q4", "q5", "guidance"].every((k) => state.ratings[letter]?.[k]);

function updateProgress() {
  const rateable = state.sets.filter((s) => s.ok);
  const done = rateable.filter((s) => complete(s.letter)).length;
  for (const s of rateable) $(`#tab-${s.letter}`).classList.toggle("complete", complete(s.letter));
  $("#rate-progress").textContent = `${done} of ${rateable.length} sets rated`;
  $("#submit").disabled = rateable.length === 0 || done < rateable.length;
}

$("#submit").addEventListener("click", async () => {
  $("#submit").disabled = true;
  $("#rate-error").hidden = true;
  try {
    await api("/api/rate", { sessionId: state.sessionId, ratings: state.ratings, comment: $("#comment").value });
    show("done");
  } catch (e) {
    $("#rate-error").textContent = e.message;
    $("#rate-error").hidden = false;
    updateProgress();
  }
});

// ---------------------------------------------------------------- next participant

$("#next").addEventListener("click", () => {
  const m = $("#code").value.trim().toUpperCase().match(/^P(\d+)$/);
  $("#code").value = m ? `P${Number(m[1]) + 1}` : "";
  for (const id of ["cv", "jobad"]) $(`#${id}`).value = "";
  $("#consent").checked = false;
  state.kind = null;
  document.querySelectorAll("#kind .opt").forEach((o) => o.setAttribute("aria-checked", "false"));
  checkSetup();
  show("setup");
});

initSetup();
