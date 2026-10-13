# Firstround question test

The Assignment 5 prototype (CS-500 AI Product Management, Group 14). It tests the learning question on our
Build-to-Learn card:

> Do free or low-cost AI models write CV-tailored interview questions that candidates rate as relevant?

The risk behind it is **Viability**. A whole mock interview must cost under CHF 0.75 (hard cap), and ideally under
CHF 0.30 including card fees, which is the 80% margin of a typical SaaS. That only works if cheap models are good enough.

## What it does

1. The facilitator pastes an **anonymised CV** and the **job ad**.
2. Four models each write 5 questions: the same **3 standard questions** for everyone, plus **2 questions tailored**
   to the CV and the job. Every question is followed by **"What your answer should contain"**: 3 points to make, each
   with why it matters to this employer.
3. The participant rates the four sets **blind**: letters A to D, in random order. For each set they rate the two
   tailored questions (relevance, 1–5), the answer guidance (usefulness, 1–5), and flag anything wrong, invented or
   inappropriate.
4. The app logs each model's **real token use, thinking included**, its list-price cost and its speed.

| Tier | Model | USD per 1M tokens, in / out |
|---|---|---|
| Free | Gemini 2.5 Flash-Lite (free tier) | 0.10 / 0.40 at list price |
| Cheapest paid | GPT-OSS 20B on Groq | 0.075 / 0.30 |
| Mid | Gemini 2.5 Flash | 0.30 / 2.50 |
| Premium | Gemini 2.5 Pro | 1.25 / 10.00 |

Prices are list prices checked on 13 Oct 2026. Thinking tokens are billed as output. The standard questions are in
`lib/prompt.js`.

## What you need

- **Node.js 20 or later.** Check with `node -v`. There is nothing to install: the app has no dependencies.
- **Two free API keys** in a file called `.env`. Copy `.env.example` to `.env` and paste the keys:
  - `GEMINI_API_KEY`: [Google AI Studio](https://aistudio.google.com/apikey) → "Create API key". The free tier runs
    all three Gemini models.
  - `GROQ_API_KEY`: [Groq console](https://console.groq.com/keys) → "Create API key". The free tier runs GPT-OSS 20B.
- Free tiers may use what is sent to them to improve their products. **Only send anonymised CVs.**

## Run it

```bash
npm start          # opens on http://127.0.0.1:8787
npm run mock       # try the whole flow without keys: placeholder questions, left out of the report
npm run report     # results per model and the decision
```

The page only opens on your own computer, because the server listens on 127.0.0.1.

## Running a session (about 15 minutes)

1. **Before:** the participant picks a job ad and sends you their CV.
   - People looking for a job use a job they would apply to.
   - People already in a job use an ad for their own role, and rate as if they were interviewing again.
2. **Anonymise the CV together.** Remove the name, email, phone, address, photo, date of birth and nationality.
3. **Setup:** fill in your initials, a participant code (P1, P2… never a name), who they are and the consent tick.
   Paste the job ad and the CV, then click "Write the questions". It takes 10 to 60 seconds.
4. **Rate:** the participant reads each set as if preparing for this interview and rates it. Don't say which model
   wrote which set.
5. **Save.** "Next participant" clears the CV and the job ad.

## Results

- Sessions are saved on your computer in `results/sessions.jsonl`. This file is never pushed to GitHub.
  - **Never saved:** the text of the CV and of the job ad.
  - **Saved:** the questions, ratings, token counts, cost and timing.
- `npm run report` prints the table for the deck and writes `results/report.md`.
- **To combine the team's sessions,** collect everyone's `sessions.jsonl` and run
  `npm run report -- mine.jsonl andrea.jsonl …`.

**Decision criteria**, set before the test (Build-to-Learn card):
- **Success:** the free or the cheapest model has ≥ 70% of tailored questions rated 4–5, within 10 points of premium.
- **Failure:** both are under 50%. Then we pay for a better model.
- **Inconclusive:** anything in between, or fewer than 8 people.

## Files

| File | What it does |
|---|---|
| `server.js` | the local server: page, model calls, saving |
| `lib/prompt.js` | the standard questions, the prompt, and the check of every reply |
| `lib/models.js` | the four models, the API calls, token counting and cost |
| `lib/mock.js` | placeholder replies for `npm run mock` |
| `public/` | the page (Firstround style) |
| `scripts/report.js` | the results per model and the decision |
| `samples/` | a fictional CV and job ad for practice |
