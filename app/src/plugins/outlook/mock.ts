/** The developer panel's Outlook: today's CALENDAR, with the developer panel's "meeting moved" scenario applied. */
import { CALENDAR, get, today } from '../../store';
import type { Impl } from '../types';
import { TABS, entriesFor } from './days';

/** where the mock calendar moves a meeting when the scenario is on */
const MOVES: Record<string, number> = { m2: 11 * 60 + 30 };

export const mock: Impl = {
  async agenda(day) {
    if (day !== today()) return []; // the mock calendar only knows today
    const moved = get().flags.meetingMoved;
    return CALENDAR.map((m) => ({ id: m.id, title: m.title, start: moved && MOVES[m.id] != null ? MOVES[m.id] : m.start, durationMin: m.durationMin, where: m.where }));
  },
  lists: TABS, // the Today tab is built from the agenda; the others are listed here
  async list(id) {
    const fake = (n: number) => [
      { id: `mx${n}a`, title: n === 1 ? 'Sprint demo' : 'Planning', start: 10 * 60, durationMin: 30, where: 'Teams' },
      { id: `mx${n}b`, title: n % 2 ? 'Customer call' : 'Architecture sync', start: 15 * 60, durationMin: 45, where: 'Room 4.12' },
    ];
    return entriesFor(id, today(), (day) => fake(Math.max(1, Math.round((Date.parse(day) - Date.parse(today())) / 864e5))));
  },
};
