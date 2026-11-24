import { supabase } from "./supabase";
import { withTimeout } from "./network";
import { rowToRecord, type RecordRow, type TimeRecord, type Profile } from "./types";

/**
 * Cross-user reads for the admin team view.
 *
 * Deliberately separate from storage.ts. That module is the signed-in user's own
 * timesheet and is wired into the offline queue and a per-user local cache — a
 * cache keyed by the *viewer*. Writing other people's rows through it would
 * corrupt the admin's own view, so nothing here touches the cache or the queue.
 *
 * These queries return other users' rows only because the RLS select policies
 * read `using (user_id = auth.uid() or is_admin())`. For a non-admin they return
 * just that person's own data — the server, not this module, is the boundary.
 *
 * Online-only by design: a manager reviewing the team can retry, unlike an
 * employee punching in from a lift.
 */

const RECORDS = "records";
const PROFILES = "profiles";
const SELECT = "id, user_id, date, time_in, time_out, total_hours, status, notes";

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: Profile["role"];
}

/** Everyone with an account, sorted by display name. */
export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await withTimeout(
    supabase
      .from(PROFILES)
      .select("id, email, full_name, avatar_url, role")
      .order("full_name", { ascending: true })
  );

  if (error) throw error;

  return (data as ProfileRow[]).map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    avatarUrl: r.avatar_url,
    role: r.role,
  }));
}

/** Every user's records for one "YYYY-MM" month. */
export async function getAllRecords(month: string): Promise<TimeRecord[]> {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  // Day 0 of the next month is the last day of this one — avoids hardcoding
  // month lengths and handles February in leap years.
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;

  const { data, error } = await withTimeout(
    supabase
      .from(RECORDS)
      .select(SELECT)
      .gte("date", first)
      .lte("date", last)
      .order("date", { ascending: false })
  );

  if (error) throw error;
  return (data as RecordRow[]).map(rowToRecord);
}

export interface TeamMemberSummary {
  profile: Profile;
  records: TimeRecord[];
  totalHours: number;
  avgHours: number;
  daysWorked: number;
  wfhDays: number;
  leaveDays: number;
  /** True when a session is still running — hours for it aren't counted yet. */
  hasOpenSession: boolean;
}

/**
 * Rolls month records up per employee.
 *
 * Everyone with an account appears, including people with no entries at all —
 * an absent employee is exactly what a manager needs to see, so omitting them
 * would hide the most important row.
 *
 * `avgHours` divides by days actually completed, matching how the employee's own
 * dashboard computes it. A "Working" record contributes no hours (it has none
 * yet) and is surfaced via `hasOpenSession` instead, so a half-finished day
 * cannot drag someone's average down.
 *
 * Pure — no I/O — so it can be tested against fixtures.
 */
export function summarizeByUser(
  records: TimeRecord[],
  profiles: Profile[]
): TeamMemberSummary[] {
  const byUser = new Map<string, TimeRecord[]>();
  for (const r of records) {
    const list = byUser.get(r.userId);
    if (list) list.push(r);
    else byUser.set(r.userId, [r]);
  }

  return profiles
    .map((profile) => {
      const own = (byUser.get(profile.id) ?? [])
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date));

      const completed = own.filter((r) => r.status === "Completed");
      const totalHours = completed.reduce((sum, r) => sum + (r.totalHours ?? 0), 0);
      const daysWorked = completed.length;

      return {
        profile,
        records: own,
        totalHours,
        daysWorked,
        avgHours: daysWorked > 0 ? totalHours / daysWorked : 0,
        wfhDays: own.filter((r) => r.status === "WFH").length,
        leaveDays: own.filter((r) => r.status === "Leave").length,
        hasOpenSession: own.some((r) => r.status === "Working"),
      };
    })
    .sort((a, b) => {
      // People with activity first, then alphabetically — so a manager sees
      // who is logging time without scrolling past empty rows.
      if (a.records.length === 0 !== (b.records.length === 0)) {
        return a.records.length === 0 ? 1 : -1;
      }
      const an = a.profile.fullName ?? a.profile.email;
      const bn = b.profile.fullName ?? b.profile.email;
      return an.localeCompare(bn);
    });
}
