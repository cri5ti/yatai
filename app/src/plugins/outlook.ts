/** Outlook calendar. Mock for now: today's CALENDAR, with the developer panel's "meeting moved" scenario applied. */
import { CALENDAR, get } from '../store';
import type { Impl, Plugin } from './types';

/** where the mock calendar moves a meeting when the scenario is on */
const MOVES: Record<string, number> = { m2: 11 * 60 + 30 };

const mock: Impl = {
  async agenda() {
    const moved = get().flags.meetingMoved;
    return CALENDAR.map((m) => ({ id: m.id, title: m.title, start: moved && MOVES[m.id] != null ? MOVES[m.id] : m.start, durationMin: m.durationMin, where: m.where }));
  },
  lists: [{ id: 'today', label: 'Today’s agenda' }], // no `list`: the drawer builds it from the agenda
};

export const outlook: Plugin = { id: 'outlook', name: 'Outlook', mock, pollMs: { active: 60_000, idle: 300_000 } };
