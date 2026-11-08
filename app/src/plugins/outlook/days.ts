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

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const weekday = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
};

/** drawer rows for the days after today: a weekday + time on the left, read-only (meetings come into Next on their day) */
export function entriesFor(tab: string, today: string, eventsOn: (day: string) => AgendaEvent[]): Entry[] {
  const days = daysOf(tab);
  return days.flatMap((n) => {
    const day = addDays(today, n);
    return eventsOn(day)
      .filter((e) => !e.cancelled)
      .map((e): Entry => ({
        ref: `outlook:${e.id}`,
        title: e.title,
        sub: `${days.length > 1 ? `${new Date(day + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ` : ''}${e.durationMin} min${e.where ? ` · ${e.where}` : ''}`,
        lead: { text: days.length > 1 ? `${weekday(day)} ${hhmm(e.start)}` : hhmm(e.start) },
        text: e.title,
        readonly: true,
        canInbox: false,
      }));
  });
}
