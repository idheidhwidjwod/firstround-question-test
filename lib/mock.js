// Mock replies for `npm run mock`: the whole flow works without API keys. Every question says [Mock],
// sessions are saved with "mock": true, and the report leaves them out.
import { STANDARD_QUESTIONS } from "./prompt.js";

const THINKING = { "flash-lite": 0, "gpt-oss-20b": 300, flash: 1000, pro: 1500 };
const TAILORED = [
  ["Walk me through the project on your CV that is closest to this job. What exactly was your part?",
   "Your CV shows less of one thing this job asks for. How would you get up to speed in your first months?"],
  ["Which result on your CV best shows you can do the core task of this job, and how did you measure it?",
   "This role works with several teams. Tell me about a time your work depended on people you did not manage."],
  ["You moved between fields on your CV. What did that change teach you that this job needs?",
   "Pick one tool from the job ad you have used. What did you build with it, and what would you do differently?"],
  ["What would you want to achieve in your first three months here, given your experience so far?",
   "Tell me about a decision in one of your projects that you would defend in front of this team."],
];

const points = (n) => [
  { point: `[Mock] A concrete example from your CV (${n})`, why: "Shows the claim is real, not generic" },
  { point: "[Mock] The result, with a number if you have one", why: "Employers remember outcomes, not tasks" },
  { point: "[Mock] The link to a requirement in the job ad", why: "Tells them you read the ad and fit it" },
];

export async function mockReply(m, cv, jobAd) {
  const v = ["flash-lite", "gpt-oss-20b", "flash", "pro"].indexOf(m.id);
  await new Promise((r) => setTimeout(r, 400 + 300 * v));
  const questions = [
    ...STANDARD_QUESTIONS.map((q, i) => ({ type: "standard", question: q, based_on: "", answer_should_contain: points(i + 1) })),
    ...TAILORED[v].map((q, i) => ({ type: "tailored", question: `[Mock] ${q}`, based_on: "mock", answer_should_contain: points(i + 4) })),
  ];
  const input = Math.round((cv.length + jobAd.length) / 4) + 900;
  return { text: JSON.stringify({ questions }), finish: "STOP",
           usage: { input, output: 800 + 40 * v, thinking: THINKING[m.id], thinkingEstimated: false } };
}
