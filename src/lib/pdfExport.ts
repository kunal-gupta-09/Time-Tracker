import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { TimeRecord } from "./types";

function fmt12(hhmm: string | null) {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtDate(d: string) {
  const [y, mo, day] = d.split("-").map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toHM(hours: number) {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// Same color rules as the dashboard (RGB tuples for jsPDF fillColor)
function totalHourFill(hours: number | null): [number, number, number] | null {
  if (hours === null || hours === 0) return null;
  if (hours > 0 && hours < 7) return [254, 226, 226]; // rose-100
  if (hours < 8) return [254, 243, 199]; // amber-100
  return [209, 250, 229]; // emerald-100
}

function totalHourText(hours: number | null): [number, number, number] {
  if (hours === null || hours === 0) return [71, 85, 105];
  if (hours > 0 && hours < 7) return [159, 18, 57]; // rose-700
  if (hours < 8) return [146, 64, 14]; // amber-700
  return [4, 120, 87]; // emerald-700
}

export function exportTimesheetPdf(opts: {
  records: TimeRecord[];
  monthLabel: string;
  totalHours: number;
  avgHours: number;
  daysWorked: number;
}) {
  const { records, monthLabel, totalHours, avgHours, daysWorked } = opts;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 41, 59);
  doc.text("Time Tracker", 40, 50);

  // Subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(100, 116, 139);
  doc.text(monthLabel, 40, 68);

  // Generated stamp on the right
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  const stamp = `Generated ${new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
  doc.text(stamp, pageWidth - 40, 50, { align: "right" });

  // Sort records ascending by date (chronological — matches the xlsx)
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));

  // Build a running TTL column (cumulative hours)
  let running = 0;
  const body = sorted.map((r) => {
    if (r.totalHours !== null) running += r.totalHours;
    return [
      fmtDate(r.date),
      fmt12(r.timeIn),
      fmt12(r.timeOut),
      r.totalHours !== null ? toHM(r.totalHours) : "—",
      toHM(running),
      r.status,
      r.notes ?? "",
    ];
  });

  autoTable(doc, {
    startY: 90,
    head: [["Date", "In", "Out", "Total Hour", "TTL", "Status", "Notes"]],
    body,
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 5,
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
      textColor: [51, 65, 85],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { halign: "center", cellWidth: 50 },
      2: { halign: "center", cellWidth: 50 },
      3: { halign: "center", fontStyle: "bold", cellWidth: 50 },
      4: { halign: "center", cellWidth: 50 },
      5: { halign: "center", cellWidth: 60 },
      6: { halign: "left", cellWidth: "auto", textColor: [71, 85, 105] },
    },
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 3) {
        const hours = sorted[data.row.index]?.totalHours ?? null;
        const fill = totalHourFill(hours);
        const text = totalHourText(hours);
        if (fill) data.cell.styles.fillColor = fill;
        data.cell.styles.textColor = text;
      }
      if (data.section === "body" && data.column.index === 5) {
        const status = sorted[data.row.index]?.status;
        if (status === "Working") {
          data.cell.styles.textColor = [67, 56, 202];
          data.cell.styles.fontStyle = "bold";
        } else if (status === "WFH") {
          data.cell.styles.textColor = [109, 40, 217]; // violet-700
          data.cell.styles.fontStyle = "bold";
        } else if (status === "Leave") {
          data.cell.styles.textColor = [180, 83, 9]; // amber-700
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  // Summary block below the table
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } })
    .lastAutoTable.finalY;
  const summaryY = finalY + 24;

  // Summary title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text("Summary", 40, summaryY);

  // Three summary boxes: Total Hours, Average Hours, Total Days
  const boxes = [
    { label: "Total Hours", value: toHM(totalHours), color: null as [number, number, number] | null },
    {
      label: "Average Hours",
      value: daysWorked > 0 ? toHM(avgHours) : "—",
      color: daysWorked > 0 ? totalHourText(avgHours) : null,
    },
    { label: "Total Days", value: String(daysWorked), color: null },
  ];

  const boxWidth = (pageWidth - 80 - 20) / 3; // 40pt margins, 10pt gap × 2
  const boxHeight = 56;
  const boxY = summaryY + 12;

  boxes.forEach((box, i) => {
    const x = 40 + i * (boxWidth + 10);
    // Box background
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, boxY, boxWidth, boxHeight, 6, 6, "FD");

    // Label
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(box.label.toUpperCase(), x + 12, boxY + 18);

    // Value
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    if (box.color) {
      doc.setTextColor(box.color[0], box.color[1], box.color[2]);
    } else {
      doc.setTextColor(30, 41, 59);
    }
    doc.text(box.value, x + 12, boxY + 42);
  });

  // Footer note
  const footerY = boxY + boxHeight + 30;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    "Color rules — red: under 7h, yellow: 7–8h, green: 8h or more.",
    40,
    footerY
  );

  // File name: time-tracker-2026-05.pdf
  const safeName = monthLabel.replace(/\s+/g, "-").toLowerCase();
  doc.save(`time-tracker-${safeName}.pdf`);
}

// New: returns the PDF as a Blob + suggested filename so callers can
// decide whether to download or share-sheet.
export function buildTimesheetPdfBlob(opts: {
  records: TimeRecord[];
  monthLabel: string;
  totalHours: number;
  avgHours: number;
  daysWorked: number;
}): { blob: Blob; filename: string } {
  // Reuse exportTimesheetPdf's logic but skip its doc.save() at the end.
  // Easiest is to inline the body here, but to avoid duplication we use a flag.
  // For minimal duplication: temporarily monkey-patch save? No — cleaner to
  // duplicate the PDF building inline.
  const { records, monthLabel, totalHours, avgHours, daysWorked } = opts;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 41, 59);
  doc.text("Time Tracker", 40, 50);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(100, 116, 139);
  doc.text(monthLabel, 40, 68);

  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  const stamp = `Generated ${new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
  doc.text(stamp, pageWidth - 40, 50, { align: "right" });

  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const body = sorted.map((r) => {
    if (r.totalHours !== null) running += r.totalHours;
    return [
      fmtDate(r.date),
      fmt12(r.timeIn),
      fmt12(r.timeOut),
      r.totalHours !== null ? toHM(r.totalHours) : "—",
      toHM(running),
      r.status,
      r.notes ?? "",
    ];
  });

  autoTable(doc, {
    startY: 90,
    head: [["Date", "In", "Out", "Total Hour", "TTL", "Status", "Notes"]],
    body,
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 5,
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
      textColor: [51, 65, 85],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { halign: "center", cellWidth: 50 },
      2: { halign: "center", cellWidth: 50 },
      3: { halign: "center", fontStyle: "bold", cellWidth: 50 },
      4: { halign: "center", cellWidth: 50 },
      5: { halign: "center", cellWidth: 60 },
      6: { halign: "left", cellWidth: "auto", textColor: [71, 85, 105] },
    },
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 3) {
        const hours = sorted[data.row.index]?.totalHours ?? null;
        const fill = totalHourFill(hours);
        const text = totalHourText(hours);
        if (fill) data.cell.styles.fillColor = fill;
        data.cell.styles.textColor = text;
      }
      if (data.section === "body" && data.column.index === 5) {
        const status = sorted[data.row.index]?.status;
        if (status === "Working") {
          data.cell.styles.textColor = [67, 56, 202];
          data.cell.styles.fontStyle = "bold";
        } else if (status === "WFH") {
          data.cell.styles.textColor = [109, 40, 217]; // violet-700
          data.cell.styles.fontStyle = "bold";
        } else if (status === "Leave") {
          data.cell.styles.textColor = [180, 83, 9]; // amber-700
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } })
    .lastAutoTable.finalY;
  const summaryY = finalY + 24;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text("Summary", 40, summaryY);

  const boxes = [
    { label: "Total Hours", value: toHM(totalHours), color: null as [number, number, number] | null },
    {
      label: "Average Hours",
      value: daysWorked > 0 ? toHM(avgHours) : "—",
      color: daysWorked > 0 ? totalHourText(avgHours) : null,
    },
    { label: "Total Days", value: String(daysWorked), color: null },
  ];

  const boxWidth = (pageWidth - 80 - 20) / 3;
  const boxHeight = 56;
  const boxY = summaryY + 12;

  boxes.forEach((box, i) => {
    const x = 40 + i * (boxWidth + 10);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, boxY, boxWidth, boxHeight, 6, 6, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(box.label.toUpperCase(), x + 12, boxY + 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    if (box.color) {
      doc.setTextColor(box.color[0], box.color[1], box.color[2]);
    } else {
      doc.setTextColor(30, 41, 59);
    }
    doc.text(box.value, x + 12, boxY + 42);
  });

  const footerY = boxY + boxHeight + 30;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    "Color rules — red: under 7h, yellow: 7–8h, green: 8h or more.",
    40,
    footerY
  );

  const safeName = monthLabel.replace(/\s+/g, "-").toLowerCase();
  const blob = doc.output("blob");
  return { blob, filename: `time-tracker-${safeName}.pdf` };
}