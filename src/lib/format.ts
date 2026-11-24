/**
 * Formatting and month helpers shared between the employee dashboard and the
 * admin team view. Extracted from DashboardPage so both screens present hours,
 * dates, and the colour vocabulary identically — a total shown to a manager must
 * match what the employee sees.
 */

/** "2026-07" for a given date. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "July 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** The last `count` months, newest first, as "YYYY-MM" keys. */
export function recentMonths(count = 12, from = new Date()): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    keys.push(monthKey(new Date(from.getFullYear(), from.getMonth() - i, 1)));
  }
  return keys;
}

/** Decimal hours as "8:30". */
export function toHM(hours: number): string {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** "9:05 AM" from "09:05". */
export function fmt12(hhmm: string | null): string {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** "Thu, Jul 30" from "2026-07-30". */
export function fmtDate(d: string): string {
  const [y, mo, day] = d.split("-").map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * The app's colour vocabulary for an hours figure: red under 7h, amber 7–8h,
 * green at 8h or more. Used for averages on both dashboards.
 */
export function avgColor(hours: number): string {
  if (hours > 0 && hours < 7) return "text-rose-600";
  if (hours >= 7 && hours < 8) return "text-amber-600";
  if (hours >= 8) return "text-emerald-600";
  return "text-slate-800";
}
