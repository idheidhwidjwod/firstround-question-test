// Firstround question test: receives every rated interview from the app and adds it to this spreadsheet.
//
// Set-up, once, by the sheet's owner (about 5 minutes):
//   1. In the Google Sheet: Extensions → Apps Script. Replace the editor's content with this file and save.
//   2. Deploy → New deployment → type "Web app". Execute as: Me. Who has access: Anyone. Deploy, and allow access.
//   3. Copy the web app URL (it ends in /exec) into lib/sheet.js as TEAM_SHEET_URL and push it to GitHub.
//      Everyone who runs the app then adds to this sheet. Anyone with the URL can add rows, which is fine here:
//      the sheet holds no personal data (never the CV or the job ad).
//
// Tabs (created on the first interview): Summary, Sessions, Questions, Runs.
// Participants are numbered here, for the whole team: P1, P2… Practice (mock) interviews are marked MOCK and left out
// of the Summary. An interview that is sent twice is only added once.

const TABS = {
  Sessions: ["Session ID", "Saved at", "Participant", "Participant is", "Models", "Comment"],
  Questions: ["Session ID", "Participant", "Participant is", "Question", "Type", "Model", "Model ID", "Effort",
              "Relevance (1–5)", "Question text", "What the interviewer wants to hear",
              "How that relates to your experience", "Rated 4–5"],
  Runs: ["Session ID", "Participant", "Model", "Model ID", "Effort", "Worked", "Input tokens", "Output tokens",
         "Thinking tokens", "Cost USD (list price)", "Cost CHF", "Seconds", "Error"],
};

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: "the request was not JSON" });
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (data.type === "ping") return reply_({ ok: true, sheet: ss.getName() });
  if (data.type !== "session" || !data.sessionId) return reply_({ ok: false, error: "unknown request" });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);   // one interview at a time, so participant numbers never repeat
  try {
    const tabs = setUp_(ss);
    const sessions = tabs.Sessions;
    const found = sessions.getRange("A:A").createTextFinder(data.sessionId).matchEntireCell(true).findNext();
    if (found) return reply_({ ok: true, duplicate: true, participant: sessions.getRange(found.getRow(), 3).getValue() });

    const realRows = sessions.getLastRow() - 1 - countMock_(sessions);
    const participant = data.mock ? "MOCK" : "P" + (realRows + 1);
    sessions.appendRow([data.sessionId, new Date(data.savedAt), participant, data.kind, data.ladder, data.comment || ""]);
    append_(tabs.Questions, data.questions.map((q) => [data.sessionId, participant, data.kind, "Q" + q.position, q.type,
      q.model, q.modelId, q.effort, q.relevance, q.question, q.wants, q.experience, q.relevance >= 4 ? 1 : 0]));
    append_(tabs.Runs, data.runs.map((r) => [data.sessionId, participant, r.model, r.modelId, r.effort, r.ok,
      r.input, r.output, r.thinking, r.costUSD, r.costCHF, r.seconds, r.error]));
    return reply_({ ok: true, participant });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return reply_({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
}

function setUp_(ss) {
  const tabs = {};
  for (const [name, headers] of Object.entries(TABS)) {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    }
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
  return tabs;
}

function countMock_(sessions) {
  const n = sessions.getLastRow() - 1;
  if (n <= 0) return 0;
  return sessions.getRange(2, 3, n, 1).getValues().filter((row) => row[0] === "MOCK").length;
}

function append_(sheet, rows) {
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
