// The prompt every model gets, and the check that turns a model's reply into 5 clean questions.
// 3 standard questions (same wording for every candidate) + 2 tailored to the CV and the job ad.
// Under every question: "What the interviewer wants to hear" (in general) and "How that relates to your experience".

export const STANDARD_QUESTIONS = [
  "Tell me about yourself.",
  "Why do you want this role?",
  "Tell me about a challenge you faced and how you handled it.",
];

export const SYSTEM_PROMPT = `You are an experienced hiring manager preparing a first-round job interview.
You receive the job ad and an anonymised CV.

Write exactly 5 interview questions:
- Questions 1 to 3 are the standard questions you are given. Keep their wording exactly.
- Questions 4 and 5 are tailored. Each one links something specific in the CV (a project, a role, a skill, a gap, a change of direction) to a specific requirement in the job ad, the way a real interviewer would probe it. The two must be about different things.

Under every question, help the candidate prepare with two short lists:
- "interviewer_wants": what the interviewer wants to hear in a good answer to this question, in general terms: the qualities, evidence or signals they will be looking for (3 points, at most 12 words each);
- "your_experience": how that relates to this candidate's experience: which projects, roles, results or skills from the CV to use (2 or 3 points, at most 20 words each).

Rules:
- Use only facts that are in the CV or the job ad. Never invent employers, dates, numbers or skills.
- Never ask about or mention age, gender, origin, nationality, family, religion, health or any other protected characteristic.
- Write in the language of the job ad.
- Reply with JSON only, in exactly this shape:
{"questions":[{"type":"standard","question":"...","based_on":"","interviewer_wants":["..."],"your_experience":["..."]},
 {"type":"tailored","question":"...","based_on":"the CV detail and the job requirement this question links","interviewer_wants":["..."],"your_experience":["..."]}]}`;

export function userPrompt(cv, jobAd) {
  return `STANDARD QUESTIONS (questions 1 to 3, same wording):
${STANDARD_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n")}

JOB AD:
"""
${jobAd.trim()}
"""

CV (anonymised):
"""
${cv.trim()}
"""`;
}

// ---------------------------------------------------------------- reading a model's reply

const str = (v) => (typeof v === "string" ? v.trim() : "");
const loose = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// A list of short points: strings, or objects with a text-like field (some models wrap points).
const points = (v) => (Array.isArray(v) ? v : [])
  .map((p) => (typeof p === "string" ? str(p) : str(p?.point ?? p?.text ?? p?.item)))
  .filter(Boolean)
  .slice(0, 4);

export function parseJson(text) {
  const t = String(text || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("the reply is not JSON");
  return JSON.parse(t.slice(a, b + 1));
}

// Returns { questions: [5 × {type, question, basedOn, wants:[...], experience:[...]}], warnings: [...] } or throws.
export function normalise(raw) {
  const warnings = [];
  if (!Array.isArray(raw?.questions)) throw new Error("no questions in the reply");
  const all = raw.questions
    .map((q) => ({
      type: q?.type === "tailored" || q?.type === "standard" ? q.type : null,
      question: str(q?.question),
      basedOn: str(q?.based_on),
      wants: points(q?.interviewer_wants),
      experience: points(q?.your_experience),
    }))
    .filter((q) => q.question);

  let standard = all.filter((q) => q.type === "standard");
  let tailored = all.filter((q) => q.type === "tailored");
  if (standard.length !== 3 || tailored.length !== 2) {
    warnings.push(`labelled ${standard.length} standard + ${tailored.length} tailored; read by position instead`);
    standard = all.slice(0, 3);
    tailored = all.slice(3, 5);
  }
  if (standard.length < 3 || tailored.length < 2) throw new Error(`only ${all.length} usable questions`);

  standard = standard.map((q, i) => {
    if (loose(q.question) !== loose(STANDARD_QUESTIONS[i])) warnings.push(`Q${i + 1} reworded; standard wording restored`);
    return { ...q, type: "standard", question: STANDARD_QUESTIONS[i], basedOn: "" };
  });
  tailored = tailored.map((q) => ({ ...q, type: "tailored" }));

  const questions = [...standard, ...tailored];
  questions.forEach((q, i) => {
    if (q.wants.length < 2) warnings.push(`Q${i + 1}: ${q.wants.length} "interviewer wants" point(s)`);
    if (q.experience.length < 1) warnings.push(`Q${i + 1}: no "your experience" point`);
  });
  if (tailored.some((q) => !q.basedOn)) warnings.push("a tailored question does not say what it is based on");
  return { questions, warnings };
}

// ---------------------------------------------------------------- one interview from several models

const words = (s) => new Set(loose(s).split(" ").filter((w) => w.length > 3));
function overlap(a, b) {
  const A = words(a), B = words(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.max(1, Math.min(A.size, B.size));
}

// Builds the single interview the participant sees: question n comes from the model drawn for position n.
// `order` is the working runs in random order; with fewer models than questions, the first ones take two.
// For the two tailored slots, the second model gives whichever of its two tailored questions is least like the
// first slot's, so the interview does not ask twice about the same thing.
export function mixInterview(order, pick = Math.random) {
  const slots = [];
  for (let pos = 1; pos <= 5; pos++) {
    const run = order[(pos - 1) % order.length];
    let index = pos - 1;
    if (pos === 4) index = 3 + Math.floor(pick() * 2);
    if (pos === 5) {
      const first = slots[3].question.question;
      const [a, b] = [run.questions[3], run.questions[4]];
      index = overlap(first, a.question) <= overlap(first, b.question) ? 3 : 4;
      if (run === order[3 % order.length] && index === slots[3].index) index = index === 3 ? 4 : 3;
    }
    slots.push({ position: pos, modelId: run.modelId, index, question: run.questions[index] });
  }
  return slots;
}
