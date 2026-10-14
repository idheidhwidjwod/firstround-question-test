# Setup guide for the team

How to run the Firstround question test on your own computer, with your own Claude account. It takes about
10 minutes the first time. Every interview you rate is copied to the team's Google Sheet **"Log week 5"**
automatically, so there is nothing to collect or send afterwards.

## 1. What you need

- **A Claude account that includes Claude Code:** Pro, Max, Team or Enterprise. The free plan doesn't include it.
  Each interview runs 5 models, including Opus at extra-high effort, so a Max plan is the most comfortable.
- **Access to the GitHub repo.** It is private: send Christophe your GitHub username to be added.
- A Mac, Windows 10 or later, or Linux, and an internet connection.

## 2. Install the tools (once)

1. **Node.js 20 or later.** Get the LTS version from [nodejs.org](https://nodejs.org), or on a Mac run
   `brew install node`. Check it in a new terminal:
   ```bash
   node -v
   ```
   You should see v20 or higher.
2. **Claude Code.**
   - On a Mac or Linux:
     ```bash
     curl -fsSL https://claude.ai/install.sh | bash
     ```
     Homebrew works too: `brew install --cask claude-code`.
   - On Windows, in PowerShell:
     ```powershell
     irm https://claude.ai/install.ps1 | iex
     ```
     WinGet works too: `winget install Anthropic.ClaudeCode`.

   Open a **new** terminal and check that it prints a version number:
   ```bash
   claude --version
   ```
3. **Log in to Claude Code.** Run `claude`, follow the login in your browser, then type `/exit`. Check:
   ```bash
   claude auth status
   ```
   You should see `"loggedIn": true`.
4. **Git**, to download the code. Macs have it: run `git --version`, and accept if macOS offers to install the
   developer tools. On Windows, install it from [git-scm.com](https://git-scm.com). You can use
   [GitHub Desktop](https://desktop.github.com) instead.

## 3. Get the code

```bash
git clone https://github.com/idheidhwidjwod/firstround-question-test.git
```

```bash
cd firstround-question-test
```

You don't need `npm install` (the app has no dependencies) or a `.env` file. Run every command below from this
`firstround-question-test` folder.

## 4. Check that it works (about 2 minutes)

1. **Can you reach the team sheet?**
   ```bash
   npm run sync-sheet -- --test
   ```
   It should print `The sheet answers: "Log week 5".`
2. **Does the page work?** Start the practice version, which uses placeholder questions and sends nothing anywhere:
   ```bash
   npm run claude-mock
   ```
   Then:
   - open http://127.0.0.1:8787;
   - click "Fill with the sample CV and job ad", choose who the participant is, and tick the consent box;
   - click "Write the questions", rate the 5 questions, and save;
   - stop the app with Ctrl+C in the terminal.
3. **Do the real models answer?** This one is optional and uses about 30 seconds of your plan. Nothing is saved or sent:
   ```bash
   npm run try-claude
   ```
   You should see the tailored questions of the 5 models and a cost table.

## 5. Run a real session

```bash
npm run claude
```

Open http://127.0.0.1:8787. The box above "Write the questions" should say:

- `claude 2.x, with your Claude login (… plan)`;
- `Your CLAUDE.md, memory, skills, plugins and connectors are switched off for these runs`;
- `Results are also copied to the team's Google Sheet`.

Then follow "Running a session" in the [README](README.md#running-a-session-about-15-minutes):

1. Anonymise the CV.
2. Paste the job ad and the CV, then click "Write the questions". It takes up to about a minute.
3. The participant rates the 5 questions, then you save.

The end screen confirms "saved on this computer and in the team's Google Sheet".

Keep the terminal open while the page is in use, and press Ctrl+C when you are done.

**Privacy:** only anonymised CVs, and never a name anywhere. The CV and the job ad stay on your computer: neither
the app nor the sheet keeps them.

## 6. Get updates

```bash
git pull
```

Then start the app again.

## Troubleshooting

| What you see | What to do |
|---|---|
| `npm error … Could not read package.json` | You are not in the project folder. Run `cd firstround-question-test`, then the command again. |
| `node: command not found`, or `node -v` below v20 | Install Node.js 20 or later (step 2), then open a new terminal. |
| `git clone` says "Repository not found", or asks for a password | The repo is private. Send Christophe your GitHub username. To log in to GitHub, use GitHub Desktop or `gh auth login`. |
| `EADDRINUSE` or "port 8787 is already in use" | The app is already running in another terminal: use that one, or stop it with Ctrl+C. To use another port, run `PORT=8788 npm run claude` (Mac/Linux) or `$env:PORT=8788; npm run claude` (PowerShell), then open http://127.0.0.1:8788. |
| The page doesn't open | Keep the terminal running `npm run claude` open, and use exactly http://127.0.0.1:8787. |
| The status box says "The claude command was not found" | Install Claude Code (step 2) and open a new terminal. `claude --version` must work in the terminal where you start the app. On Windows, use the PowerShell installer or WinGet. |
| The status box says "claude is logged out" | Run `claude`, log in, type `/exit`, then restart `npm run claude`. |
| "No model answered" after "Write the questions" | Look at the terminal: every failed model prints a line saying why. The usual causes are being logged out, your plan's usage limit, or no internet. |
| One model fails, for example "not available on your plan" or a usage limit | The interview still works with the other models (one of them writes two questions). For the real test, run sessions on a plan that has all five models, and tell the team. |
| "no answer within 300 s" | A model was very slow, usually Opus at extra-high effort. Try again. |
| The status box says "The team's Google Sheet is not set up yet" | Your copy is old. Run `git pull` and restart. |
| The end screen says the copy to the Google Sheet failed | The ratings are safe on your computer. When the internet is back, run `npm run sync-sheet`: it sends what is missing, and never twice. |
| `npm run sync-sheet -- --test` says HTTP 403 or "did not answer" | Check your internet. If it keeps failing, tell Christophe: the sheet's script may need to be authorised again by its owner. |
| Something else | Run `claude doctor` for Claude Code problems, and send the team the last lines of the terminal. |

**Where do results go?** To the team sheet (tab Summary for the per-model numbers), and on your computer to
`results/sessions.jsonl`. `npm run report` prints the numbers from your computer's sessions only.
