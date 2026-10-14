// The prompt every model gets, the check that turns a model's reply into clean questions, and the mixer that builds
// the one interview the participant sees. Every question is tailored to the CV and the job ad. Under each one:
// "What the interviewer wants to hear" (in general) and "Practical tips" (how to structure the answer, what to put in it).

export const QUESTIONS_PER_INTERVIEW = 5;

export const SYSTEM_PROMPT = `You are an experienced hiring manager preparing a first-round job interview.
You receive the job ad and an anonymised CV.

Write exactly 5 interview questions tailored to this candidate. Each one links something specific in the CV (a project, a role, a result, a skill, a gap, a change of direction) to a specific requirement in the job ad, the way a real interviewer would probe it. The 5 questions must be about different things.

Under every question, help the candidate prepare with two short lists:
- "interviewer_wants": what the interviewer wants to hear in a good answer, in general terms: the qualities, evidence or signals they look for (3 points, at most 12 words each);
- "practical_tips": how to build a strong answer: how to structure it (for example situation, action, result), which examples or facts from the CV to use, and what to avoid (3 points, at most 20 words each).

Rules:
- Use only facts that are in the CV or the job ad. Never invent employers, dates, numbers or skills.
- Never ask about or mention age, gender, origin, nationality, family, religion, health or any other protected characteristic.
- Write in the language of the job ad.
- Reply with JSON only, in exactly this shape:
{"questions":[{"question":"...","based_on":"the CV detail and the job requirement this question links","interviewer_wants":["...","...","..."],"practical_tips":["...","...","..."]}]}`;

export function userPrompt(cv, jobAd) {
  return `JOB AD:
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
  .map((p) => (typeof p === "string" ? str(p) : str(p?.point ?? p?.text ?? p?.tip ?? p?.item)))
  .filter(Boolean)
  .slice(0, 4);

export function parseJson(text) {
  const t = String(text || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("the reply is not JSON");
  return JSON.parse(t.slice(a, b + 1));
}

// Returns { questions: [{type, question, basedOn, wants:[...], tips:[...]}], warnings: [...] } or throws.
// Fewer than 3 usable questions makes the reply unusable (it is then asked again); 3 or 4 only give a warning.
export function normalise(raw) {
  const warnings = [];
  if (!Array.isArray(raw?.questions)) throw new Error("no questions in the reply");
  const questions = raw.questions
    .map((q) => ({
      type: "tailored",
      question: str(q?.question),
      basedOn: str(q?.based_on),
      wants: points(q?.interviewer_wants),
      tips: points(q?.practical_tips ?? q?.tips),
    }))
    .filter((q) => q.question);
  if (questions.length < 3) throw new Error(`only ${questions.length} usable questions`);
  if (questions.length !== QUESTIONS_PER_INTERVIEW) warnings.push(`${questions.length} questions instead of ${QUESTIONS_PER_INTERVIEW}`);
  if (questions.length > QUESTIONS_PER_INTERVIEW) questions.length = QUESTIONS_PER_INTERVIEW;
  questions.forEach((q, i) => {
    if (q.wants.length < 2) warnings.push(`Q${i + 1}: ${q.wants.length} "interviewer wants" point(s)`);
    if (q.tips.length < 2) warnings.push(`Q${i + 1}: ${q.tips.length} practical tip(s)`);
  });
  if (questions.some((q) => !q.basedOn)) warnings.push("a question does not say what it is based on");
  return { questions, warnings };
}

// ---------------------------------------------------------------- one interview from several models

// Words that say nothing about a question's topic, so they do not count when comparing two questions.
const COMMON = new Set(`your yours would could should this that these those with what when where which while about
  into from have there their they them then than also more most much many some such tell describe explain give walk
  through role jobs work team time example examples experience project projects company here want using used make
  votre vous avec pour dans comment quel quelle quels quelles cette être avez nous notre leur leurs plus tout faire
  ihre ihren sich mit wie welche diese haben nicht auch noch eine einen einem`.split(/\s+/));
const words = (s) => new Set(loose(s).split(" ").filter((w) => w.length > 3 && !COMMON.has(w)));
function overlap(a, b) {
  const A = words(a), B = words(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.max(1, Math.min(A.size, B.size));
}

// Builds the interview the participant sees: question n comes from the model drawn for position n (`order` is the
// working runs in random order; with fewer models than questions, the first ones give two). From that model's
// questions it takes the one least like the questions already chosen, so the interview never asks twice about the
// same thing. The first question is drawn at random; ties are broken at random.
export function mixInterview(order, pick = Math.random) {
  const chosen = [];
  for (let pos = 1; pos <= QUESTIONS_PER_INTERVIEW; pos++) {
    const run = order[(pos - 1) % order.length];
    const taken = new Set(chosen.filter((c) => c.modelId === run.modelId).map((c) => c.index));
    const candidates = run.questions.map((question, index) => ({ question, index })).filter((c) => !taken.has(c.index));
    const scored = candidates.map((c) => ({
      ...c,
      score: chosen.length ? Math.max(...chosen.map((x) => overlap(x.question.question, c.question.question))) : 0,
      tie: pick(),
    }));
    scored.sort((a, b) => a.score - b.score || a.tie - b.tie);
    chosen.push({ position: pos, modelId: run.modelId, index: scored[0].index, question: scored[0].question });
  }
  return chosen;
}
