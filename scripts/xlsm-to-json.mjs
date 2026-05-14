// Reads the extracted Time_tracker1 xlsm sheets and emits an importable JSON
// file matching the TimeSheet app's expected shape.
//
// Each sheet has the same layout:
//   Row 1       : headers (Date, In, Out, Total Min, Total Hour)
//   Rows 2-13   : data
//                 col A = Excel date serial (the punch date)
//                 col B = Excel datetime serial (punch-in; time fraction matters)
//                 col C = Excel datetime serial (punch-out; time fraction matters)
//   Rows 14+    : summary / blank
//
// We use column A as the canonical date and the *time fraction* of B and C
// for in/out times.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SHEETS_DIR = "C:\\Users\\kuka0922\\AppData\\Local\\Temp\\1\\xlsm_extract\\xl\\worksheets";
const SHEETS = ["sheet1.xml", "sheet2.xml", "sheet3.xml", "sheet4.xml", "sheet5.xml"];
const OUT_PATH = "C:\\Users\\kuka0922\\Desktop\\timesheet-import.json";

// Excel serial 25569 = 1970-01-01. (Valid for dates ≥ 1900-03-01.)
function excelSerialToDate(serial) {
  return new Date((serial - 25569) * 86400 * 1000);
}

function fmtDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtTime(serial) {
  const fraction = serial - Math.floor(serial);
  const totalMinutes = Math.round(fraction * 24 * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseSheet(xml) {
  const records = [];
  // Match each row, capture row number + body
  const rowRe = /<row\s+r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowNum = Number(rowMatch[1]);
    if (rowNum < 2 || rowNum > 13) continue;
    const body = rowMatch[2];

    // Match each <c r="A2" ...>...<v>NUM</v>...</c>  (or self-closing → skip)
    const cells = {};
    const cellRe = /<c\s+([^>\/]+)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(body))) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2];
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      if (!refMatch) continue;
      const col = refMatch[1];
      const valMatch = /<v>([^<]+)<\/v>/.exec(inner);
      if (valMatch) cells[col] = Number(valMatch[1]);
    }

    if (cells.A && cells.B && cells.C) {
      const date = fmtDate(excelSerialToDate(cells.A));
      const timeIn = fmtTime(cells.B);
      const timeOut = fmtTime(cells.C);
      records.push({ date, timeIn, timeOut });
    }
  }
  return records;
}

const all = [];
for (const fileName of SHEETS) {
  const xml = readFileSync(join(SHEETS_DIR, fileName), "utf8");
  const recs = parseSheet(xml);
  console.log(`${fileName}: ${recs.length} entries`);
  all.push(...recs);
}

// De-dupe identical date+timeIn+timeOut tuples (rare but possible across sheets)
const seen = new Set();
const deduped = all.filter((r) => {
  const k = `${r.date}|${r.timeIn}|${r.timeOut}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// Sort chronologically
deduped.sort((a, b) =>
  a.date === b.date ? a.timeIn.localeCompare(b.timeIn) : a.date.localeCompare(b.date)
);

writeFileSync(OUT_PATH, JSON.stringify(deduped, null, 2));
console.log(`\nWrote ${deduped.length} entries to:\n  ${OUT_PATH}`);

// Quick month breakdown
const byMonth = deduped.reduce((acc, r) => {
  const m = r.date.slice(0, 7);
  acc[m] = (acc[m] || 0) + 1;
  return acc;
}, {});
console.log("\nBreakdown by month:");
for (const m of Object.keys(byMonth).sort()) {
  console.log(`  ${m}: ${byMonth[m]} entries`);
}