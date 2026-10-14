# Firstround question test

The Assignment 5 prototype (CS-500 AI Product Management, Group 14). It tests the learning question on our
Build-to-Learn card:

> Do free or low-cost AI models write CV-tailored interview questions that candidates rate as relevant?

**Teammates: start with [SETUP.md](SETUP.md).** It covers installing, a first run and troubleshooting.

The risk behind it is **Viability**. A whole mock interview must cost under CHF 0.75 (hard cap), and ideally under
CHF 0.30 including card fees, which is the 80% margin of a typical SaaS. That only works if cheap models are good enough.

## What it does

1. The facilitator pastes an **anonymised CV** and the **job ad**.
2. Every model writes a full interview: the same **3 standard questions** for everyone, plus **2 questions tailored**
   to the CV and the job. Under every question come two short notes:
   - **"What the interviewer wants to hear"**: what they look for in a good answer, in general;
   - **"How that relates to your experience"**: which parts of the CV to use.
3. The participant sees **one interview that mixes the models**. Each question comes from a model drawn at random,
   so with 5 models each model gives one question. The two tailored slots never ask about the same thing.
4. The participant rates **every question for relevance**, 1 to 5. They don't know which model wrote which.
5. The app logs each model's **real token use, thinking included**, its list-price cost and its speed for the full
   interview it wrote.

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

## The Claude version: five Claude set-ups with your own Claude login

No API key needed: it runs the `claude` command (Claude Code) on your computer with your Claude login.

| Tier | Model | Effort | USD per 1M tokens, in / out |
|---|---|---|---|
| Cheapest | Claude Haiku 5.5 | default | 0.10 / 0.50 |
| Mid | Claude Sonnet 5.5 | low | 2 / 10 |
| Mid | Claude Sonnet 5.5 | high | 2 / 10 |
| Premium | Claude Opus 5.5 | medium | 4 / 20 |
| Premium | Claude Opus 5.5 | extra high (`xhigh`) | 4 / 20 |

```bash
npm run try-claude                         # in the terminal: the 5 set-ups on the sample CV, with tokens, cost, time
npm run try-claude -- cv.txt job-ad.txt    # the same on your own text files (anonymise the CV first)
npm run try-claude -- --full               # also print the standard questions and the notes under every question
npm run claude                             # the rating page: one interview mixing these 5 models
npm run claude-mock                        # the same page with placeholder questions
```

You need Claude Code installed and logged in (`claude auth login`). The runs use your plan's allowance;
the costs shown are what the same tokens would cost at API list prices.

**Your personal setup is switched off for every run**, so it behaves like a plain API call and costs as little as
possible:

- **Prompt:** our system prompt replaces Claude Code's long one, and there are no tools. A run is a single plain answer.
- **Nothing personal is loaded:** no CLAUDE.md, memory, skills, plugins, hooks, MCP connectors, agents, output styles
  or settings files (`--safe-mode`, `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`).
- **Clean start:** the command runs in an empty folder with a clean environment. That drops variables from a Claude
  desktop session, such as a default effort level.
- **No caching:** prompt caching is off. A one-off prompt would only pay the cache-write premium.
- **Nothing saved:** `--no-session-persistence`, so CVs never land in `~/.claude`. The CV goes in through stdin, so it
  doesn't show in the process list either.

What a Claude login still adds to every request, about 400 tokens: an identity line, a short description of the
environment, the date, and the account's email address. To remove those too, put an `ANTHROPIC_API_KEY` in
`.env`: the command then runs with `--bare` and that key, billed per token. The exact command is in `lib/claude.js`.

Run on the sample CV (14 Oct 2026, current notes format), one full interview of 5 questions per model:

| | Haiku 5.5 | Sonnet low | Sonnet high | Opus medium | Opus extra high |
|---|---|---|---|---|---|
| Thinking tokens | 1,370 | 0 | 1,115 | 0 | 1,922 |
| Cost at list price | $0.0014 | $0.016 | $0.027 | $0.030 | $0.070 |
| Time | 14 s | 10 s | 18 s | 12 s | 29 s |

## Running a session (about 15 minutes)

1. **Before:** the participant picks a job ad and sends you their CV.
   - People looking for a job use a job they would apply to.
   - People already in a job use an ad for their own role, and rate as if they were interviewing again.
2. **Anonymise the CV together.** Remove the name, email, phone, address, photo, date of birth and nationality.
3. **Setup:** choose who the participant is and tick consent, paste the job ad and the CV, then click "Write the
   questions". It takes 10 to 60 seconds.
   - Participants are **numbered automatically** in the saved results (P1, P2… on each computer). The page doesn't
     show the number, and there is no field for a name.
   - A number counts once the ratings are saved, so an abandoned session gives its number back.
4. **Rate:** the participant reads the interview as if preparing for it and rates each question's relevance.
   Don't say which model wrote which question. Anything wrong or invented goes in the comment box.
5. **Save.** "Next participant" clears the CV and the job ad.

## Results

- Sessions are saved on your computer in `results/sessions.jsonl`. This file is never pushed to GitHub.
  - **Never saved:** the text of the CV and of the job ad.
  - **Saved:** the questions, ratings, token counts, cost and timing.
- `npm run report` prints the table for the deck and writes `results/report.md`.
- **To combine the team's sessions,** collect everyone's `sessions.jsonl` and run
  `npm run report -- mine.jsonl andrea.jsonl …`. Numbers restart at P1 on each computer, so the report counts
  P1 in two files as two different people.

## The team's Google Sheet

Every rated interview is also copied to one shared Google Sheet, so the whole team's results are in one place.
Nobody has to set anything up: the sheet's address is built into `lib/sheet.js`. Practice (mock) sessions are not sent.

- **Tabs:**
  - **Summary:** share of questions rated 4–5 per model, tailored questions only, cost and time per model, number of people.
  - **Sessions:** one row per interview.
  - **Questions:** one row per question, with its model, relevance score and notes.
  - **Runs:** one row per model, with tokens, cost and time.
- **Participant numbers:** the sheet numbers participants for the whole team (P1, P2…). The page never shows them.
- **What goes there:** the questions, notes, models, scores, comment, tokens, cost and time. Never the CV or the
  job ad. Anyone with the address can add rows, which is fine for this data.
- **If a copy fails** (no network, say), the interview is still saved on the computer. `npm run sync-sheet` sends
  what is missing, and an interview is never added twice. `npm run sync-sheet -- --test` checks that the sheet answers.

**One-time set-up by the sheet's owner** (about 5 minutes):
1. Create a Google Sheet, then open Extensions → Apps Script.
2. Replace the editor's content with `sheet/apps-script.gs` and save.
3. Deploy → New deployment → type "Web app". Set Execute as: Me, and Who has access: Anyone. Deploy and allow
   access. A school account may not offer "Anyone"; use a personal Google account then.
4. Copy the web app URL (it ends in `/exec`) into `lib/sheet.js` as `TEAM_SHEET_URL`, and push to GitHub.

**Decision criteria**, set before the test (Build-to-Learn card), applied to every question's relevance:
- **Success:** a cheap model (free or cheapest) has ≥ 70% of its questions rated 4–5, within 10 points of premium.
- **Failure:** every cheap model is under 50%. Then we pay for a better model.
- **Inconclusive:** anything in between, or fewer than 8 people.

Each interview gives every model about one question. 8 people therefore give each model about 8 ratings, and about
3 of them on tailored questions. The report shows tailored and standard questions separately too.

## Files

| File | What it does |
|---|---|
| `server.js` | the local server: page, model calls, saving |
| `lib/prompt.js` | the standard questions, the prompt, and the check of every reply |
| `lib/models.js` | the two model ladders, the API calls, token counting and cost |
| `lib/claude.js` | the isolated `claude -p` call of the Claude version |
| `lib/mock.js` | placeholder replies for `npm run mock` and `npm run claude-mock` |
| `public/` | the page (Firstround style) |
| `scripts/report.js` | the results per model and the decision, one table per ladder |
| `scripts/try-claude.js` | the Claude version in the terminal |
| `lib/sheet.js` | the copy to the team's Google Sheet (its address is set here) |
| `sheet/apps-script.gs` | the script that receives the interviews inside the Google Sheet |
| `scripts/sync-sheet.js` | sends to the sheet what is missing (`npm run sync-sheet`) |
| `samples/` | a fictional CV and job ad for practice |
