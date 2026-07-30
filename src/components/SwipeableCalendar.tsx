import { useState, useRef, useMemo, useEffect, type ReactNode } from "react";
import type { TimeRecord } from "../lib/types";

/** Shifts a "YYYY-MM" key by n months. */
export function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Cell =
  | { kind: "blank" }
  | { kind: "day"; day: number; dateStr: string; record: TimeRecord | undefined };

function buildCells(monthKey: string, records: TimeRecord[]): Cell[] {
  const [yearStr, monStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monStr);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sun

  const byDate = new Map<string, TimeRecord>();
  for (const r of records) {
    if (r.date.startsWith(monthKey)) byDate.set(r.date, r);
  }

  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ kind: "blank" });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${yearStr}-${monStr}-${String(d).padStart(2, "0")}`;
    cells.push({ kind: "day", day: d, dateStr, record: byDate.get(dateStr) });
  }
  while (cells.length % 7 !== 0) cells.push({ kind: "blank" });
  return cells;
}

interface Props {
  month: string;
  records: TimeRecord[];
  onMonthChange: (month: string) => void;
  /**
   * Renders one day cell. Kept in the parent so cell styling, today's ring,
   * and the pending badge all stay defined in one place.
   */
  renderCell: (cell: Extract<Cell, { kind: "day" }>) => ReactNode;
  /** Latest month reachable by swiping. Prevents paging into the future. */
  maxMonth: string;
  /** Earliest month reachable by swiping. */
  minMonth: string;
}

/**
 * A month grid you can swipe between.
 *
 * Three months are rendered side by side in a track — previous, current, next —
 * and the track is translated by ±100% to page. Dragging moves the track with
 * the finger; releasing past a threshold commits, otherwise it springs back.
 */
export default function SwipeableCalendar({
  month,
  records,
  onMonthChange,
  renderCell,
  maxMonth,
  minMonth,
}: Props) {
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  const canGoPrev = prevMonth >= minMonth;
  const canGoNext = nextMonth <= maxMonth;

  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Non-zero while the track animates toward a neighbouring panel. +1 means
  // it is travelling to the previous month, -1 to the next.
  const [settling, setSettling] = useState<-1 | 0 | 1>(0);
  // True for the single frame where the month has just changed and the track
  // snaps back to centre. Transitions are suppressed so that jump is unseen.
  const [recentring, setRecentring] = useState(false);

  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"undecided" | "horizontal" | "vertical">("undecided");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Panel width drives the transform, so it must be known before the first
  // paint and kept current through rotation and window resizes.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const panels = useMemo(
    () => [
      { key: prevMonth, cells: buildCells(prevMonth, records) },
      { key: month, cells: buildCells(month, records) },
      { key: nextMonth, cells: buildCells(nextMonth, records) },
    ],
    [prevMonth, month, nextMonth, records]
  );

  // Keyboard paging — swipe alone would strand keyboard and screen-reader users.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      // Ignore repeats while a page is mid-flight, otherwise held arrows queue
      // up settles that all resolve against a stale month.
      if (settling !== 0) return;
      if (e.key === "ArrowLeft" && canGoPrev) {
        e.preventDefault();
        setSettling(1);
      } else if (e.key === "ArrowRight" && canGoNext) {
        e.preventDefault();
        setSettling(-1);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [canGoPrev, canGoNext, settling]);

  function onPointerDown(e: React.PointerEvent) {
    // Ignore secondary buttons; let day-cell taps through untouched.
    if (e.button !== 0) return;
    // Don't let a new drag start mid-settle — the month hasn't committed yet,
    // so the gesture would compute against the wrong panel.
    if (settling !== 0) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    axis.current = "undecided";
    setDragging(true);
    setSettling(0);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;

    // Decide intent once, from the dominant direction, so a vertical page
    // scroll doesn't get hijacked into a month change.
    if (axis.current === "undecided") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (axis.current === "horizontal") {
        containerRef.current?.setPointerCapture(e.pointerId);
      }
    }
    if (axis.current !== "horizontal") return;

    // Resist dragging past the ends rather than hard-blocking, so the limit
    // is felt rather than reading as a broken gesture.
    let next = dx;
    if ((dx > 0 && !canGoPrev) || (dx < 0 && !canGoNext)) next = dx * 0.25;
    setDragX(next);
  }

  function endDrag() {
    if (!dragging) return;
    setDragging(false);

    if (axis.current !== "horizontal") {
      setDragX(0);
      return;
    }

    const threshold = Math.min(70, (width || 1) * 0.22);

    // Only start the animation here. The month must NOT change yet: swapping
    // content in the same tick means the browser never paints the "from"
    // position, so it animates back to centre with the new data already in
    // place — which reads as the card springing back. onMonthChange fires on
    // transitionend instead.
    if (dragX > threshold && canGoPrev) {
      setSettling(1);
    } else if (dragX < -threshold && canGoNext) {
      setSettling(-1);
    }
    setDragX(0);
    axis.current = "undecided";
  }

  /**
   * Runs when the settle animation finishes. The track is now parked over a
   * neighbouring panel, so we commit the month and recentre in the same tick —
   * with transitions suppressed, making the recentre invisible.
   */
  function handleTransitionEnd() {
    if (settling === 0) return;
    const target = settling === 1 ? prevMonth : nextMonth;
    setRecentring(true);
    setSettling(0);
    onMonthChange(target);
  }

  // Clear the no-transition flag one frame after recentring, so normal
  // animation resumes for the next gesture.
  useEffect(() => {
    if (!recentring) return;
    const id = requestAnimationFrame(() => setRecentring(false));
    return () => cancelAnimationFrame(id);
  }, [recentring]);

  // Safety net: transitionend does not fire if the transform never actually
  // changes (width still 0, reduced-motion, a backgrounded tab). Without this
  // the component would latch with settling stuck and ignore all input.
  useEffect(() => {
    if (settling === 0) return;
    const id = setTimeout(handleTransitionEnd, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settling]);

  // Panels are each one container wide, so the middle one is centred by
  // shifting the track left by exactly one panel. `settling` slides it to a
  // neighbour; `dragX` follows the finger.
  const translate = `${-width + settling * width + dragX}px`;
  const animating = !dragging && !recentring;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label="Month calendar. Use left and right arrow keys to change month."
      className="overflow-hidden pb-4 touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 rounded-lg"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Weekday header sits outside the track so it doesn't slide */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-semibold text-slate-400 uppercase py-1"
          >
            {w}
          </div>
        ))}
      </div>

      <div
        className="flex"
        style={{
          transform: `translateX(${translate})`,
          transition: animating
            ? "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "none",
        }}
        onTransitionEnd={handleTransitionEnd}
      >
        {panels.map((panel) => (
          // Each panel is exactly one container width, so the 7-column grid
          // inside matches the original layout and cells stay square.
          <div
            key={panel.key}
            className="w-full shrink-0"
            // Neighbouring months are visible mid-swipe but must not be
            // tappable — a tap there would open the wrong month's day.
            // Applied to the panel so no per-cell wrapper is needed, which
            // would otherwise disturb the grid's square cell sizing.
            {...(panel.key !== month
              ? { "aria-hidden": true, style: { pointerEvents: "none" as const } }
              : {})}
          >
            <div className="grid grid-cols-7 gap-1">
              {panel.cells.map((cell, i) =>
                cell.kind === "blank" ? (
                  <div key={i} className="aspect-square" />
                ) : (
                  renderCell(cell)
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { buildCells };
export type { Cell };
