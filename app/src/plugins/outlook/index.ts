import { today } from '../../store';
import { pluginGetSecretUrl, pluginSecretSet, pluginSecretStatus } from '../../platform';
import { isTauri } from '../../platform';
import { AuthError } from '../types';
import type { Impl, Plugin } from '../types';
import { TABS, entriesFor } from './days';
import { meetingsOn, parseIcs } from './ics';
import type { Calendar } from './ics';
import { mock } from './mock';

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

/** Outlook through its "publish a calendar" feed: read-only, no sign-in, no admin. The feed is slow to reflect changes. */
const live: Impl = {
  lists: TABS,
  async list(id) {
    const cal = await load();
    return entriesFor(id, today(), (day) => meetingsOn(cal, day, localTz()));
  },
  async agenda(day) {
    return meetingsOn(await load(), day, localTz());
  },
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
    configured: async () => (await pluginSecretStatus(ID)).configured,
    async who() {
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
  // the feed itself lags behind Outlook, so asking more often does not help
  pollMs: { active: 5 * 60_000, idle: 15 * 60_000 },
};
