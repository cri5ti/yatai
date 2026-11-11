/** The calendar through Microsoft Graph (the Microsoft account in Settings): live, no published feed. */
import type { AgendaEvent } from '../types';
import { graph } from '../entra';

export interface GraphEvent {
  id: string;
  subject?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Graph gives UTC wall times without an offset ("2026-11-12T09:00:00.0000000") when asked for UTC */
const utc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.split('.')[0]}Z`);

/** the meetings that start on `day` (yyyy-mm-dd, local time), earliest first; all-day events are left out, as with the feed */
export function toAgenda(events: GraphEvent[], day: string): AgendaEvent[] {
  const out: AgendaEvent[] = [];
  for (const e of events) {
    if (e.isAllDay) continue;
    const s = utc(e.start.dateTime);
    if (isNaN(+s) || dayOf(s) !== day) continue; // an event that began yesterday and runs into today is not today's
    const len = Math.max(1, Math.round((+utc(e.end.dateTime) - +s) / 60000));
    out.push({ id: `gr-${e.id}`, title: e.subject || '(no title)', start: s.getHours() * 60 + s.getMinutes(), durationMin: len, where: e.location?.displayName ?? '', cancelled: e.isCancelled || undefined });
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

/** the events between two local days (`from` .. `to`, both yyyy-mm-dd, `to` exclusive), through calendarView so recurring ones are expanded */
export function fetchRange(from: string, to: string): Promise<GraphEvent[]> {
  const iso = (d: string) => new Date(`${d}T00:00:00`).toISOString();
  const q = `startDateTime=${encodeURIComponent(iso(from))}&endDateTime=${encodeURIComponent(iso(to))}&$select=id,subject,start,end,isAllDay,isCancelled,location&$orderby=start/dateTime&$top=100`;
  return graph<GraphEvent>('outlook', `/me/calendarView?${q}`, { pages: 5, headers: { Prefer: 'outlook.timezone="UTC"' } });
}
