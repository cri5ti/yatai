import { cx } from './kbd';

/** A small calendar that lives inside the command menu (/due → Pick a date…). Dates are local yyyy-mm-dd. */

const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** same day next month (clamped: Jan 31 + 1 month = Feb 28/29) */
export const addMonths = (d: Date, n: number) => {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** does this locale write the day before the month (31/12 rather than 12/31)? */
const DAY_FIRST = /^31/.test(new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric' }).format(new Date(2000, 11, 31)));

/** a date that has passed this year means next year's */
const upcoming = (m: number, d: number) => {
  const t = today();
  const x = new Date(t.getFullYear(), m, d);
  return x < t ? new Date(t.getFullYear() + 1, m, d) : x;
};

/**
 * Typed shortcuts: "today", "tom", "+3", "+2w", "fri" (the next one), "20" (the next 20th),
 * "nov 20" / "20 nov", "20/11" (in the locale's day/month order), "2026-11-20". Returns null while it does not (yet) parse.
 */
export function parseDay(raw: string): Date | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const t = today();
  if ('today'.startsWith(s) && s.length >= 3) return t;
  if ('tomorrow'.startsWith(s) && s.length >= 3) return addDays(t, 1);
  let m = /^\+(\d+)\s*([dwm]?)$/.exec(s);
  if (m) return m[2] === 'm' ? addMonths(t, +m[1]) : addDays(t, +m[1] * (m[2] === 'w' ? 7 : 1));
  // a weekday by any prefix of 2+ letters ("fr", "fri", "friday"): the next one, never today
  const wd = s.length >= 2 ? DAYS.findIndex((d) => d.startsWith(s)) : -1;
  if (wd >= 0) return addDays(t, (wd - t.getDay() + 7) % 7 || 7);
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s))) {
    const [mo, d] = DAY_FIRST ? [+m[2], +m[1]] : [+m[1], +m[2]]; // 11/2 is 11 Feb or Nov 2, as the locale writes dates
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? upcoming(mo - 1, d) : null;
  }
  const mi = (w: string) => (w.length >= 3 ? MONTHS.findIndex((mo) => w.startsWith(mo)) : -1);
  if ((m = /^([a-z]+)\s*(\d{1,2})$/.exec(s)) && mi(m[1]) >= 0) return upcoming(mi(m[1]), +m[2]);
  if ((m = /^(\d{1,2})\s*([a-z]+)$/.exec(s)) && mi(m[2]) >= 0) return upcoming(mi(m[2]), +m[1]);
  if ((m = /^(\d{1,2})$/.exec(s)) && +m[1] >= 1 && +m[1] <= 31) {
    const x = new Date(t.getFullYear(), t.getMonth(), +m[1]);
    return x < t || x.getMonth() !== t.getMonth() ? new Date(t.getFullYear(), t.getMonth() + 1, +m[1]) : x;
  }
  return null;
}

/** what a key does to the cursor date (null: not a calendar key) */
export function calKey(k: string, shift: boolean, cur: Date): Date | null {
  if (k === 'ArrowLeft') return addDays(cur, -1);
  if (k === 'ArrowRight') return addDays(cur, 1);
  if (k === 'ArrowUp') return shift ? addMonths(cur, -1) : addDays(cur, -7);
  if (k === 'ArrowDown') return shift ? addMonths(cur, 1) : addDays(cur, 7);
  if (k === 'PageUp') return addMonths(cur, -1);
  if (k === 'PageDown') return addMonths(cur, 1);
  if (k === 'Home') return today();
  return null;
}

export function Calendar({ cursor, value, onCursor, onPick }: { cursor: Date; value?: string; onCursor: (d: Date) => void; onPick: (d: Date) => void }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7)); // weeks start on Monday
  const t = toIso(today());
  const c = toIso(cursor);
  return (
    <div className="cal-pick" role="grid" aria-label={`${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`}>
      <div className="cal-head">
        <button tabIndex={-1} aria-label="Previous month" onMouseDown={(e) => e.preventDefault()} onClick={() => onCursor(addMonths(cursor, -1))}>
          ‹
        </button>
        <b>
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
        </b>
        <button tabIndex={-1} aria-label="Next month" onMouseDown={(e) => e.preventDefault()} onClick={() => onCursor(addMonths(cursor, 1))}>
          ›
        </button>
      </div>
      <div className="cal-grid">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <span key={d} className="cal-dow">
            {d}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDays(start, i);
          const iso = toIso(d);
          return (
            <button
              key={iso}
              tabIndex={-1}
              role="gridcell"
              aria-selected={iso === c}
              className={cx('cal-day', d.getMonth() !== cursor.getMonth() && 'out', iso < t && 'past', iso === t && 'today', iso === value && 'cur', iso === c && 'hi')}
              title={iso}
              onMouseDown={(e) => e.preventDefault()} // keep the typing focus in the menu input
              onClick={() => onPick(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
