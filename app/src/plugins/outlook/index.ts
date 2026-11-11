import { today } from '../../store';
import { pluginGetSecretUrl, pluginSecretSet, pluginSecretStatus } from '../../platform';
import { isTauri } from '../../platform';
import { AuthError } from '../types';
import type { Impl, Plugin } from '../types';
import { TABS, entriesFor } from './days';
import { meetingsOn, parseIcs } from './ics';
import type { Calendar } from './ics';
import { mock } from './mock';
import { entraOn, entraStatus, whoAmI } from '../entra';
import { addDays } from './days';
import { fetchRange, toAgenda } from './graph';
import type { GraphEvent } from './graph';

const ID = 'outlook';
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

let cached: { at: number; cal: Calendar } | null = null;
/** the feed, at most once every 30 s (the agenda and a drawer tab ask in the same cycle) */
async function load(): Promise<Calendar> {
  if (cached && Date.now() - cached.at < 30_000) return cached.cal;
  const cal = await fetchCalendar();
  cached = { at: Date.now(), cal };
  return cal;
}
async function fetchCalendar() {
  const r = await pluginGetSecretUrl(ID);
  if (r.status === 404 || r.status === 410) throw new AuthError('The published calendar link no longer works: publish it again and paste the new link');
  if (r.status < 200 || r.status >= 300) throw new Error(`The calendar link answered ${r.status}`);
  if (!/BEGIN:VCALENDAR/i.test(r.body)) throw new Error('That link is not an .ics calendar (use the ICS link, not the HTML one)');
  return parseIcs(r.body);
}

const viaGraph = () => entraOn('calendar');

/** Graph events for a window of days, at most once every 30 s per window (the agenda and a drawer tab ask in the same cycle) */
const windows = new Map<string, { at: number; events: GraphEvent[] }>();
async function graphWindow(from: string, to: string): Promise<GraphEvent[]> {
  const key = `${from}|${to}`;
  const hit = windows.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.events;
  const events = await fetchRange(from, to);
  windows.set(key, { at: Date.now(), events });
  if (windows.size > 8) windows.delete(windows.keys().next().value as string);
  return events;
}
/** yesterday .. a week ahead covers every tab and the days of meetings in Next; any other day is asked for by itself */
async function graphDay(day: string): Promise<GraphEvent[]> {
  const t = today();
  const [from, to] = day >= addDays(t, -1) && day < addDays(t, 8) ? [addDays(t, -1), addDays(t, 8)] : [day, addDays(day, 1)];
  return graphWindow(from, to);
}

/** Outlook through its "publish a calendar" feed: read-only, no sign-in, no admin. The feed is slow to reflect changes. */
const feed: Impl = {
  lists: TABS,
  async list(id) {
    const cal = await load();
    return entriesFor(id, today(), (day) => meetingsOn(cal, day, localTz()));
  },
  async agenda(day) {
    return meetingsOn(await load(), day, localTz());
  },
};
/** …or through Microsoft Graph when the Microsoft account is signed in for the calendar: live */
const graphImpl: Impl = {
  lists: TABS,
  async list(id) {
    const evs = await graphDay(addDays(today(), 1));
    return entriesFor(id, today(), (day) => toAgenda(evs, day));
  },
  async agenda(day) {
    return toAgenda(await graphDay(day), day);
  },
};
const live: Impl = {
  lists: TABS,
  list: (id) => (viaGraph() ? graphImpl : feed).list!(id),
  agenda: (day) => (viaGraph() ? graphImpl : feed).agenda!(day),
};

export const outlook: Plugin = {
  id: ID,
  name: 'Calendar',
  auth: {
    field: {
      label: 'Calendar link (ICS)',
      placeholder: 'https://outlook.office365.com/owa/calendar/…/calendar.ics',
      help: 'Your published calendar’s ICS link. Outlook refreshes a published calendar slowly (minutes to hours).',
    },
    configured: async () => (await entraStatus(), viaGraph() || (await pluginSecretStatus(ID)).configured),
    async who() {
      if (viaGraph()) {
        const evs = await graphDay(today());
        const n = toAgenda(evs, today()).length;
        return `${await whoAmI(ID)} · ${n} meeting${n === 1 ? '' : 's'} today`;
      }
      const cal = await load();
      const n = meetingsOn(cal, today(), localTz()).length;
      return `${cal.name ?? 'calendar'} · ${n} meeting${n === 1 ? '' : 's'} today`;
    },
    async connect(url) {
      let u: URL;
      try {
        u = new URL(url.trim());
      } catch {
        throw new Error('That is not a link');
      }
      if (u.protocol !== 'https:') throw new Error('The link must start with https://');
      cached = null;
      await pluginSecretSet(ID, u.hostname, url.trim());
      try {
        return await this.who();
      } catch (e) {
        await pluginSecretSet(ID, u.hostname, '').catch(() => {});
        throw e;
      }
    },
    disconnect: async () => void (await pluginSecretSet(ID, 'x', '')),
  },
  live: isTauri ? live : undefined,
  mock,
  // the published feed lags behind Outlook (asking more often does not help); Graph is live
  pollMs: { active: 3 * 60_000, idle: 10 * 60_000 },
};
