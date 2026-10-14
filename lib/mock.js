// Mock replies for `npm run mock`, `claude-mock` and `chatgpt-mock`: the whole flow works without keys or model calls.
// Every question says [Mock], sessions are saved with "mock": true, and the report leaves them out.

const THINKING = { "flash-lite": 0, "gpt-oss-20b": 300, flash: 1000, pro: 1500,
  haiku: 0, "sonnet-low": 200, "sonnet-high": 1500, "opus-medium": 900, "opus-xhigh": 3000,
  luna: 0, "sol-low": 200, "sol-high": 1500, "astra-medium": 900, "astra-xhigh": 3000,
  "luna-low": 0, "luna-high": 800, "luna-5-6": 300, "terra-medium": 900, "terra-xhigh": 3000 };
const POOL = [
  "Walk me through the project on your CV that is closest to this job. What exactly was your part?",
  "Your CV shows less of one thing this job asks for. How would you get up to speed in your first months?",
  "Which result on your CV best shows you can do the core task of this job, and how did you measure it?",
  "This role works with several teams. Tell me about a time your work depended on people you did not manage.",
  "You moved between fields on your CV. What did that change teach you that this job needs?",
  "Pick one tool from the job ad you have used. What did you build with it, and what would you do differently?",
  "What would you want to achieve in your first three months here, given your experience so far?",
  "Tell me about a decision in one of your projects that you would defend in front of this team.",
  "Which part of this job would be new for you, and what in your CV shows you can learn it fast?",
  "Tell me about feedback on your work that changed how you do it.",
];

const notes = (n) => ({
  interviewer_wants: [`[Mock] A clear, concrete example (${n})`, "[Mock] Your own part, not only the team's", "[Mock] A result you can measure"],
  practical_tips: ["[Mock] Open with the situation in one sentence, then what you did", "[Mock] Use the project on your CV closest to this job",
    "[Mock] End with the result and what you would do the same way here"],
});

export async function mockReply(m, index, cv, jobAd) {
  await new Promise((r) => setTimeout(r, 400 + 300 * index));
  const questions = [0, 1, 2, 3, 4].map((k) => ({ question: `[Mock] ${POOL[(index * 2 + k) % POOL.length]}`, based_on: "mock", ...notes(k + 1) }));
  const input = Math.round((cv.length + jobAd.length) / 4) + 900;
  return { text: JSON.stringify({ questions }), finish: "STOP",
           usage: { input, output: 900 + 40 * index, thinking: THINKING[m.id] ?? 0, thinkingEstimated: false } };
}
