// The prompt every model gets, and the check that turns a model's reply into 5 clean questions.
// 3 standard questions (same wording for every candidate) + 2 tailored to the CV and the job ad.
// Every question comes with "What your answer should contain": points to make, and why each matters.

export const STANDARD_QUESTIONS = [
  "Tell me about yourself.",
  "Why do you want this role?",
  "Tell me about a challenge you faced and how you handled it.",
];

export const SYSTEM_PROMPT = `You are an experienced hiring manager preparing a first-round job interview.
You receive the job ad and an anonymised CV.

Write exactly 5 interview questions:
- Questions 1 to 3 are the standard questions you are given. Keep their wording exactly.
- Questions 4 and 5 are tailored. Each one links something specific in the CV (a project, a role, a skill, a gap, a change of direction) to a specific requirement in the job ad, the way a real interviewer would probe it.

After every question, write "What your answer should contain": 3 short points. Each point has:
- "point": what the candidate should say, specific to this CV and this job (at most 15 words);
- "why": why it matters to this employer, tied to the job ad (at most 15 words).

Rules:
- Use only facts that are in the CV or the job ad. Never invent employers, dates, numbers or skills.
- Never ask about or mention age, gender, origin, nationality, family, religion, health or any other protected characteristic.
- Write in the language of the job ad.
- Reply with JSON only, in exactly this shape:
{"questions":[{"type":"standard","question":"...","based_on":"","answer_should_contain":[{"point":"...","why":"..."}]},
 {"type":"tailored","question":"...","based_on":"the CV detail and the job requirement this question links","answer_should_contain":[{"point":"...","why":"..."}]}]}`;

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

export function parseJson(text) {
  const t = String(text || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("the reply is not JSON");
  return JSON.parse(t.slice(a, b + 1));
}

// Returns { questions: [5 × {type, question, basedOn, points:[{point, why}]}], warnings: [...] } or throws.
export function normalise(raw) {
  const warnings = [];
  if (!Array.isArray(raw?.questions)) throw new Error("no questions in the reply");
  const all = raw.questions
    .map((q) => ({
      type: q?.type === "tailored" || q?.type === "standard" ? q.type : null,
      question: str(q?.question),
      basedOn: str(q?.based_on),
      points: (Array.isArray(q?.answer_should_contain) ? q.answer_should_contain : [])
        .map((p) => (typeof p === "string" ? { point: str(p), why: "" } : { point: str(p?.point), why: str(p?.why) }))
        .filter((p) => p.point),
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
    if (q.points.length < 2) warnings.push(`Q${i + 1}: ${q.points.length} answer point(s)`);
    if (q.points.length > 4) q.points = q.points.slice(0, 4);
    if (q.points.some((p) => !p.why)) warnings.push(`Q${i + 1}: a point has no "why"`);
  });
  if (tailored.some((q) => !q.basedOn)) warnings.push("a tailored question does not say what it is based on");
  return { questions, warnings };
}
