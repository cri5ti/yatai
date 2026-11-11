import type { Entry, ListDef } from '../types';
import type { AgendaEvent } from '../types';

export const TABS: ListDef[] = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'next5', label: 'Next 5 days' },
];

/** yyyy-mm-dd, `n` days after `day` (calendar days, local) */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
/** the days a tab shows, after today */
export const daysOf = (tab: string): number[] => (tab === 'tomorrow' ? [1] : tab === 'next5' ? [1, 2, 3, 4, 5] : []);

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const weekday = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
};

/** events that overlap another one of the same list (double bookings) */
export function clashes(evs: Pick<AgendaEvent, 'id' | 'start' | 'durationMin'>[]): Set<string> {
  const out = new Set<string>();
  for (const a of evs) for (const b of evs) if (a !== b && a.start < b.start + b.durationMin && b.start < a.start + a.durationMin) out.add(a.id);
  return out;
}
export const range = (e: Pick<AgendaEvent, 'start' | 'durationMin'>) => `${hhmm(e.start)}–${hhmm(e.start + e.durationMin)}`;

/** drawer rows for the days after today: a weekday + time range on the left; a meeting can be brought in ahead, to prepare */
export function entriesFor(tab: string, today: string, eventsOn: (day: string) => AgendaEvent[]): Entry[] {
  const days = daysOf(tab);
  return days.flatMap((n) => {
    const day = addDays(today, n);
    const evs = eventsOn(day).filter((e) => !e.cancelled);
    const clash = clashes(evs);
    return evs
      .map((e): Entry => ({
        ref: `outlook:${e.id}`,
        title: e.title,
        sub: '',
        clash: clash.has(e.id),
        lead: { text: days.length > 1 ? `${weekday(day)} ${range(e)}` : range(e) },
        text: e.title,
        meeting: { id: e.id, title: e.title, start: e.start, durationMin: e.durationMin, where: e.where, day },
        canInbox: false,
      }));
  });
}
