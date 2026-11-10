/**
 * Reminders (/remind): when to come back to an item. Pure: presets, a typed time, and how to show one.
 * A reminder is an absolute time (ms) on the item; when it comes the item is brought into Next, highlighted and announced.
 */
import { parseDay } from './DatePick';

export type Preset = { id: string; label: string; key: string; at: (now: Date, workStart: number) => Date };

/** a day at the start of the working day (minutes of the day) */
const atWork = (d: Date, workStart: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(workStart / 60), workStart % 60);
const plus = (now: Date, min: number) => new Date(now.getTime() + min * 60_000);
/** the next Monday, never today */
export const nextMonday = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + (((8 - now.getDay()) % 7) || 7));

export const PRESETS: Preset[] = [
  { id: 'r5m', label: 'In 5 min', key: '1', at: (n) => plus(n, 5) },
  { id: 'r15m', label: 'In 15 min', key: '2', at: (n) => plus(n, 15) },
  { id: 'r30m', label: 'In 30 min', key: '3', at: (n) => plus(n, 30) },
  { id: 'r1h', label: 'In 1 hour', key: '4', at: (n) => plus(n, 60) },
  { id: 'r2h', label: 'In 2 hours', key: '5', at: (n) => plus(n, 120) },
  { id: 'r4h', label: 'In 4 hours', key: '6', at: (n) => plus(n, 240) },
  { id: 'rtom', label: 'Tomorrow', key: '7', at: (n, w) => atWork(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1), w) },
  { id: 'rmon', label: 'Next Monday', key: '8', at: (n, w) => atWork(nextMonday(n), w) },
];

/** "14:30", "9:05", "2pm", "2:30pm", "9am" → minutes of the day */
function parseTime(s: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m || (m[2] == null && !m[3])) return null; // a bare number is a day ("20"), not a time
  let h = +m[1];
  const min = m[2] != null ? +m[2] : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  }
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/**
 * A typed time, after `now`: "20m", "90 min", "2h", "1h30", "1h 30m", "14:30", "2pm" (today, or tomorrow once past),
 * any day `parseDay` knows ("fri", "tomorrow", "next monday", "nov 20", "+2d") at the start of the working day,
 * or a day and a time ("fri 10:00", "tomorrow 15:00", "nov 20 9am"). null while it does not (yet) parse, or is past.
 */
export function parseWhen(raw: string, now: Date, workStart: number): Date | null {
  const s = raw.trim().toLowerCase().replace(/^in\s+/, '').replace(/^next\s+/, '').replace(/\s+/g, ' ');
  if (!s) return null;
  const ahead = (d: Date | null) => (d && d.getTime() > now.getTime() ? d : null);
  // a duration
  let m = /^\+?(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*(?:m|min|mins|minutes?)?)?$/.exec(s);
  if (m && (m[1] || m[2]) && (m[1] || /m/.test(s))) return ahead(plus(now, (m[1] ? +m[1] * 60 : 0) + (m[2] ? +m[2] : 0)));
  // a time of day: the next one
  const t = parseTime(s);
  if (t != null) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(t / 60), t % 60);
    return d > now ? d : new Date(d.getTime() + 864e5);
  }
  // a day and a time
  m = /^(.+?)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/.exec(s);
  if (m) {
    const day = parseDay(m[1]);
    const tm = parseTime(m[2]);
    if (day && tm != null) return ahead(new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(tm / 60), tm % 60));
  }
  // a day
  const day = parseDay(s);
  return day ? ahead(atWork(day, workStart)) : null;
}

const hhmm = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** how a reminder reads on its chip and in toasts: "in 25 min", "14:30", "tomorrow 09:00", "Mon 09:00", "20 Nov 09:00" */
export function remindLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const mins = Math.round((at - now) / 60_000);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 864e5);
  if (days === 0) return mins < 1 ? 'now' : mins < 60 ? `in ${mins} min` : hhmm(d);
  if (days === 1) return `tomorrow ${hhmm(d)}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${hhmm(d)}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${hhmm(d)}`;
}
