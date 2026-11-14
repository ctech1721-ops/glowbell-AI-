import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function useNow(interval = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return now;
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatLongDate(date) {
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** Month grid with today highlighted. onPick(date) is optional. */
export function MiniCalendar({ onPick, selected }) {
  const now = useNow(60000);
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const out = Array(first.getDay()).fill(null);
    for (let d = 1; d <= total; d += 1) out.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    return out;
  }, [cursor]);

  const shift = (n) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <div className="gx-cal">
      <div className="gx-cal-head">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button>
        <strong>{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
        <button type="button" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={17} /></button>
      </div>
      <div className="gx-cal-grid">
        {DAY_LABELS.map((d) => <span key={d} className="gx-cal-dow">{d}</span>)}
        {cells.map((date, i) => date ? (
          <button
            type="button"
            key={i}
            className={`gx-cal-day${sameDay(date, now) ? " is-today" : ""}${selected && sameDay(date, selected) ? " is-selected" : ""}`}
            onClick={() => onPick?.(date)}
            aria-label={formatLongDate(date)}
            aria-current={sameDay(date, now) ? "date" : undefined}
          >{date.getDate()}</button>
        ) : <span key={i} />)}
      </div>
      <button type="button" className="gx-cal-today" onClick={() => setCursor(new Date(now.getFullYear(), now.getMonth(), 1))}>
        Jump to today
      </button>
    </div>
  );
}

/** Header chip showing today's date; opens a calendar popover. */
export function DateChip({ onAsk }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const target = picked || now;

  return (
    <div className="gx-datechip-wrap" ref={ref}>
      <button type="button" className="gx-datechip" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Open calendar">
        <CalendarDays size={17} />
        <span className="gx-datechip-text">
          {now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
        </span>
      </button>
      {open && (
        <div className="gx-pop gx-datepop" role="dialog" aria-label="Calendar">
          <div className="gx-pop-date">
            <small>{sameDay(target, now) ? "Today" : "Selected"}</small>
            <strong>{formatLongDate(target)}</strong>
          </div>
          <MiniCalendar selected={picked} onPick={setPicked} />
          <div className="gx-pop-actions">
            <button type="button" onClick={() => { setOpen(false); onAsk(`Plan a productive schedule for ${formatLongDate(target)}.`); }}>
              <Sparkles size={14} /> Plan this day
            </button>
            <button type="button" onClick={() => { setOpen(false); onAsk(`What notable events happened on ${target.toLocaleDateString(undefined, { day: "numeric", month: "long" })} in history?`); }}>
              <Sparkles size={14} /> This day in history
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Big "today" card for the welcome screen. */
export function TodayCard() {
  const now = useNow(15000);
  return (
    <section className="gx-today" aria-label="Today">
      <div className="gx-today-main">
        <small>{now.toLocaleDateString(undefined, { weekday: "long" })}</small>
        <strong>{now.getDate()}</strong>
        <span>{now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <em>{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</em>
      </div>
      <MiniCalendar />
    </section>
  );
}
