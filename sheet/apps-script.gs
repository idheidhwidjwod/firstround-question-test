// Firstround question test: receives every rated interview from the app and adds it to this spreadsheet.
//
// Set-up, once, by the sheet's owner (about 5 minutes):
//   1. In the Google Sheet: Extensions → Apps Script. Replace the editor's content with this file and save.
//   2. Deploy → New deployment → type "Web app". Execute as: Me. Who has access: Anyone. Deploy, and allow access.
//   3. Copy the web app URL (it ends in /exec) into lib/sheet.js as TEAM_SHEET_URL and push it to GitHub.
//      Everyone who runs the app then adds to this sheet. Anyone with the URL can add rows, which is fine here:
//      the sheet holds no personal data (never the CV or the job ad).
//
// Tabs: Summary, Sessions, Questions, Runs, and Contacts (emails left on the end screen by people who want news about
// the project: a separate list with the date only, never linked to a session or a participant number).
// Participants are numbered here, for the whole team: P1, P2… Practice (mock) interviews are marked MOCK and left out
// of the Summary. An interview that is sent twice is only added once.
// The answers to the two questions about paying: Sessions columns G and H, counted in the Summary from row 35.
//
// After changing this script: Deploy → Manage deployments → pencil → Version: New version → Deploy. That keeps the
// same URL. (A "New deployment" makes a new URL, and the app keeps sending to the old one.)

// Raised with every change to this script; `npm run sync-sheet -- --test` shows it, so you can check the
// deployment runs the latest version.
const SCRIPT_VERSION = 3;

const TABS = {
  Sessions: ["Session ID", "Saved at", "Participant", "Participant is", "Models", "Comment", "Preferred payment",
             "Most per month"],
  Questions: ["Session ID", "Participant", "Participant is", "Question", "Type", "Model", "Model ID", "Effort",
              "Relevance (1–5)", "Question text", "What the interviewer wants to hear", "Practical tips", "Rated 4–5"],
  Runs: ["Session ID", "Participant", "Model", "Model ID", "Effort", "Worked", "Input tokens", "Output tokens",
         "Thinking tokens", "Cost USD (list price)", "Cost CHF", "Seconds", "Error"],
  Contacts: ["Date", "Email"],
};

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: "the request was not JSON" });
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (data.type !== "ping" && data.type !== "contact" && (data.type !== "session" || !data.sessionId)) {
    return reply_({ ok: false, error: "unknown request" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);   // one request at a time, so participant numbers never repeat
  try {
    const tabs = setUp_(ss);
    if (data.type === "ping") return reply_(Object.assign({ ok: true, sheet: ss.getName(), version: SCRIPT_VERSION },
                                                          counts_(tabs.Sessions)));
    if (data.type === "contact") return addContact_(tabs.Contacts, data);
    const sessions = tabs.Sessions;
    const found = sessions.getRange("A:A").createTextFinder(data.sessionId).matchEntireCell(true).findNext();
    if (found) {
      // Sent before: add nothing, but fill in the answers about paying if an older script left them out.
      const answers = sessions.getRange(found.getRow(), 7, 1, 2);
      const sent = data.survey || {};
      const filled = answers.getValues()[0].join("") === "" && Boolean(sent.payment || sent.monthly);
      if (filled) answers.setValues([[text_(sent.payment || ""), text_(sent.monthly || "")]]);
      return reply_({ ok: true, duplicate: true, filled, participant: sessions.getRange(found.getRow(), 3).getValue(),
                      version: SCRIPT_VERSION });
    }

    const realRows = sessions.getLastRow() - 1 - countMock_(sessions);
    const participant = data.mock ? "MOCK" : "P" + (realRows + 1);
    const survey = data.survey || {};
    sessions.appendRow([data.sessionId, new Date(data.savedAt), participant, data.kind, data.ladder, data.comment || "",
      survey.payment || "", survey.monthly || ""].map(text_));
    append_(tabs.Questions, data.questions.map((q) => [data.sessionId, participant, data.kind, "Q" + q.position, q.type,
      q.model, q.modelId, q.effort, q.relevance, q.question, q.wants, q.tips || q.experience || "", q.relevance >= 4 ? 1 : 0]));
    append_(tabs.Runs, data.runs.map((r) => [data.sessionId, participant, r.model, r.modelId, r.effort, r.ok,
      r.input, r.output, r.thinking, r.costUSD, r.costCHF, r.seconds, r.error]));
    return reply_({ ok: true, participant, version: SCRIPT_VERSION });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return reply_({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName(), version: SCRIPT_VERSION });
}

// An email left to stay informed: the date and the email only, never with a session or a participant number.
// The reply is the same whether the email was new or already listed, so the web app reveals nothing about the list.
function addContact_(contacts, data) {
  const email = String(data.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return reply_({ ok: false, error: "not an email address" });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
  if (!contacts.getRange("B:B").createTextFinder(email).matchEntireCell(true).findNext()) contacts.appendRow([date, text_(email)]);
  return reply_({ ok: true, version: SCRIPT_VERSION });
}

// For `npm run sync-sheet -- --test`: how many real interviews the sheet holds, and how many have answers about paying.
function counts_(sessions) {
  const n = sessions.getLastRow() - 1;
  const rows = n > 0 ? sessions.getRange(2, 3, n, 6).getValues().filter((r) => r[0] !== "" && r[0] !== "MOCK") : [];
  return { interviews: rows.length, withPayingAnswers: rows.filter((r) => r[4] !== "" || r[5] !== "").length };
}

function setUp_(ss) {
  const tabs = {};
  for (const [name, headers] of Object.entries(TABS)) {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    // The header row is rewritten every time, so a renamed column (e.g. "Practical tips") updates by itself.
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    tabs[name] = sheet;
  }
  if (!ss.getSheetByName("Summary")) {
    const s = ss.insertSheet("Summary", 0);
    const real = "B <> 'MOCK'";
    s.getRange("A1").setValue("All questions, per model").setFontWeight("bold");
    s.getRange("A2").setFormula(`=IFERROR(QUERY(Questions!A1:M, "select F, count(I), sum(M)/count(I), avg(I) where I is not null and ${real} group by F label F 'Model', count(I) 'Ratings', sum(M)/count(I) 'Rated 4–5', avg(I) 'Mean relevance'", 1), "No ratings yet")`);
    s.getRange("A12").setValue("Tailored questions only").setFontWeight("bold");
    s.getRange("A13").setFormula(`=IFERROR(QUERY(Questions!A1:M, "select F, count(I), sum(M)/count(I), avg(I) where I is not null and E = 'tailored' and ${real} group by F label F 'Model', count(I) 'Ratings', sum(M)/count(I) 'Rated 4–5', avg(I) 'Mean relevance'", 1), "No ratings yet")`);
    s.getRange("A23").setValue("Cost and time per run (one full interview of 5 questions)").setFontWeight("bold");
    s.getRange("A24").setFormula(`=IFERROR(QUERY(Runs!A1:M, "select C, count(J), avg(J), avg(K), avg(L), avg(I) where F = true and ${real} group by C label C 'Model', count(J) 'Runs', avg(J) 'Cost USD', avg(K) 'Cost CHF', avg(L) 'Seconds', avg(I) 'Thinking tokens'", 1), "No runs yet")`);
    s.getRange("H1").setValue("People who rated").setFontWeight("bold");
    s.getRange("H2").setFormula(`=COUNTIFS(Sessions!C2:C, "<>MOCK", Sessions!C2:C, "<>")`);
    s.getRange("H4").setValue("Decision rule: a cheap model needs ≥ 70% rated 4–5, within 10 points of premium, with at least 8 people.");
    s.getRange("C3:C11").setNumberFormat("0%");
    s.getRange("C14:C22").setNumberFormat("0%");
    s.getRange("D3:D22").setNumberFormat("0.0");
    s.getRange("C25:D33").setNumberFormat("0.0000");
    s.setColumnWidth(1, 220);
  }
  // Answers to the two questions about paying (added on 14 Oct; written into an existing Summary too).
  const sum = ss.getSheetByName("Summary");
  if (sum.getRange("A35").getValue() === "") {
    const real = "C <> 'MOCK'";
    sum.getRange("A35").setValue("How would you prefer to pay?").setFontWeight("bold");
    sum.getRange("A36").setFormula(`=IFERROR(QUERY(Sessions!A1:H, "select G, count(A) where G is not null and G <> '' and ${real} group by G label G 'Answer', count(A) 'People'", 1), "No answers yet")`);
    sum.getRange("D35").setValue("Most you would spend on practice in one month").setFontWeight("bold");
    sum.getRange("D36").setFormula(`=IFERROR(QUERY(Sessions!A1:H, "select H, count(A) where H is not null and H <> '' and ${real} group by H label H 'Answer', count(A) 'People'", 1), "No answers yet")`);
  }
  return tabs;
}

function countMock_(sessions) {
  const n = sessions.getLastRow() - 1;
  if (n <= 0) return 0;
  return sessions.getRange(2, 3, n, 1).getValues().filter((row) => row[0] === "MOCK").length;
}

function append_(sheet, rows) {
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows.map((r) => r.map(text_)));
}

// Text that starts like a formula ("- too generic", "+1", "=…") is kept as text: Sheets would otherwise try to
// calculate it, show an error, or run a formula someone sent on purpose.
function text_(v) {
  return typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
