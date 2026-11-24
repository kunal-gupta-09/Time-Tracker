import { describe, it, expect } from "vitest";
import {
  decideAutoPunch,
  applyActionLocal,
  sortEvents,
  followUpNotice,
  dateStrFromMs,
  timeStrFromMs,
} from "./autoPunch";
import type { TimeRecord } from "./types";
import type { GeofenceEventType } from "./geofence";

/** Local-time epoch ms for 2026-11-<day> hh:mm. */
const at = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m).getTime();

let seq = 0;
const ev = (type: GeofenceEventType, ms: number) => ({
  id: `e${String(++seq).padStart(4, "0")}`,
  userId: "u1",
  type,
  timestampMs: ms,
});

let idSeq = 0;
const newId = () => `r${++idSeq}`;

/** Runs events through decide + apply, the way the runner does. */
function run(events: ReturnType<typeof ev>[], records: TimeRecord[] = []): TimeRecord[] {
  let rs = records;
  for (const e of sortEvents(events)) {
    rs = applyActionLocal(rs, decideAutoPunch(e, rs, newId));
  }
  return rs;
}

const rec = (over: Partial<TimeRecord>): TimeRecord => ({
  id: "existing",
  userId: "u1",
  date: "2026-11-24",
  timeIn: "",
  timeOut: null,
  totalHours: null,
  status: "Completed",
  ...over,
});

describe("time helpers", () => {
  it("formats event time in local time", () => {
    expect(dateStrFromMs(at(24, 9, 2))).toBe("2026-11-24");
    expect(timeStrFromMs(at(24, 9, 2))).toBe("09:02");
  });
});

describe("decideAutoPunch — first in / last out", () => {
  it("first ENTER of the day starts a Working session at the event time", () => {
    const [r] = run([ev("enter", at(24, 9, 2))]);
    expect(r).toMatchObject({ date: "2026-11-24", timeIn: "09:02", timeOut: null, status: "Working" });
  });

  it("ENTER → EXIT → ENTER → EXIT keeps the first in and the last out", () => {
    const rs = run([
      ev("enter", at(24, 9, 0)),
      ev("exit", at(24, 13, 0)), // lunch
      ev("enter", at(24, 14, 0)),
      ev("exit", at(24, 18, 30)),
    ]);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({
      timeIn: "09:00",
      timeOut: "18:30",
      totalHours: 9.5,
      status: "Completed",
    });
  });

  it("re-entry reopens the day as Working without moving timeIn", () => {
    const rs = run([ev("enter", at(24, 9, 0)), ev("exit", at(24, 13, 0)), ev("enter", at(24, 14, 0))]);
    expect(rs[0]).toMatchObject({ timeIn: "09:00", timeOut: null, totalHours: null, status: "Working" });
  });

  it("applies events in time order even if they arrive out of order", () => {
    const rs = run([
      ev("exit", at(24, 18, 0)),
      ev("enter", at(24, 9, 0)),
      ev("exit", at(24, 12, 0)),
      ev("enter", at(24, 12, 30)),
    ]);
    expect(rs[0]).toMatchObject({ timeIn: "09:00", timeOut: "18:00", status: "Completed" });
  });

  it("a replayed ENTER on an open session is a no-op", () => {
    const rs = run([ev("enter", at(24, 9, 0))]);
    const a = decideAutoPunch(ev("enter", at(24, 9, 5)), rs);
    expect(a.kind).toBe("none");
  });

  it("a replayed EXIT with nothing open is a no-op", () => {
    const rs = run([ev("enter", at(24, 9, 0)), ev("exit", at(24, 18, 0))]);
    expect(decideAutoPunch(ev("exit", at(24, 18, 0)), rs).kind).toBe("none");
  });

  it("an EXIT before the session started is ignored", () => {
    const rs = [rec({ status: "Working", timeIn: "10:00" })];
    expect(decideAutoPunch(ev("exit", at(24, 9, 30)), rs).kind).toBe("none");
  });

  it("an arrival earlier than the recorded timeIn becomes the new first-in", () => {
    const rs = run([ev("enter", at(24, 8, 45))], [rec({ status: "Working", timeIn: "09:30" })]);
    expect(rs[0]).toMatchObject({ timeIn: "08:45", status: "Working" });
  });

  it("an arrival inside an already-recorded span changes nothing", () => {
    const rs = [rec({ timeIn: "09:00", timeOut: "18:00", totalHours: 9 })];
    expect(decideAutoPunch(ev("enter", at(24, 12, 0)), rs).kind).toBe("none");
  });

  it("an arrival after a manual punch-out reopens the day (last out wins)", () => {
    const rs = run([ev("enter", at(24, 19, 0))], [rec({ timeIn: "09:00", timeOut: "17:00", totalHours: 8 })]);
    expect(rs[0]).toMatchObject({ id: "existing", timeIn: "09:00", status: "Working", timeOut: null });
  });
});

describe("decideAutoPunch — days that must not be touched", () => {
  it.each(["WFH", "Leave"] as const)("skips ENTER on a %s day", (status) => {
    const rs = [rec({ status })];
    const a = decideAutoPunch(ev("enter", at(24, 9, 0)), rs);
    expect(a).toMatchObject({ kind: "skip", status });
    expect(applyActionLocal(rs, a)).toEqual(rs);
  });

  it("only notifies about a skip on the same day", () => {
    const a = decideAutoPunch(ev("enter", at(24, 9, 0)), [rec({ status: "Leave" })]);
    expect(followUpNotice(a, "2026-11-24")?.title).toBe("Auto punch-in skipped");
    expect(followUpNotice(a, "2026-11-25")).toBeNull();
  });
});

describe("decideAutoPunch — notes and overnight", () => {
  it("a notes-only day becomes Working and keeps its notes and id", () => {
    const rs = run([ev("enter", at(24, 9, 0))], [rec({ status: "Note", notes: "client visit" })]);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ id: "existing", status: "Working", timeIn: "09:00", notes: "client visit" });
  });

  it("an overnight EXIT closes yesterday's session across midnight", () => {
    const rs = run([ev("enter", at(24, 20, 0)), ev("exit", at(25, 2, 30))]);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ date: "2026-11-24", timeOut: "02:30", totalHours: 6.5, status: "Completed" });
  });

  it("a missed exit yesterday doesn't block today, and warns", () => {
    const stale = rec({ id: "y", date: "2026-11-23", status: "Working", timeIn: "09:00" });
    const a = decideAutoPunch(ev("enter", at(24, 9, 0)), [stale], newId);
    expect(a.kind).toBe("create");
    expect(followUpNotice(a, "2026-11-24")?.title).toBe("A punch-out is missing");
    const rs = applyActionLocal([stale], a);
    expect(rs.find((r) => r.id === "y")?.status).toBe("Working"); // left for the user
    expect(rs.find((r) => r.date === "2026-11-24")?.status).toBe("Working");
  });
});
