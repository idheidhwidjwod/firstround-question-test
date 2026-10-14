// The two questions about paying, asked after the five interview questions. The page, the server's check, the copy to
// the team sheet and the report all read them from here. Codes are what is saved; labels are what people see.
export const SURVEY = [
  {
    key: "payment",
    question: "How would you prefer to pay?",
    options: [
      { code: "per-interview", label: "Per interview" },
      { code: "pack-10", label: "A pack of 10 interviews" },
      { code: "subscription", label: "Monthly subscription, with unlimited interviews" },
      { code: "would-not-pay", label: "I wouldn’t pay for this" },
    ],
  },
  {
    key: "monthly",
    question: "What’s the most you would spend on interview practice in one month?",
    options: [
      { code: "0", label: "Nothing" },
      { code: "5", label: "Up to CHF 5" },
      { code: "10", label: "Up to CHF 10" },
      { code: "20", label: "Up to CHF 20" },
      { code: "30", label: "Up to CHF 30" },
      { code: "30+", label: "More than CHF 30" },
    ],
  },
];

export const surveyLabel = (key, code) =>
  SURVEY.find((q) => q.key === key)?.options.find((o) => o.code === code)?.label || "";
