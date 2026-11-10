/**
 * The Emails source's state, kept in the store (saved): every mail it has seen recently and the bucket the local
 * model sorted it into. Pure functions only, so they can be tested without Outlook or a model.
 */
import type { Entry, ListDef } from '../types';

export type Bucket = 'urgent' | 'today' | 'eventually' | 'dismiss';
export const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'today', label: 'Today' },
  { id: 'eventually', label: 'Eventually' },
  { id: 'dismiss', label: 'Dismiss' },
];
export const isBucket = (x: unknown): x is Bucket => BUCKETS.some((b) => b.id === x);

/** one mail as mail.ps1 reports it (`body` only the first time) */
export interface Fetched {
  id: string;
  conv?: string;
  received: string; // ISO, UTC
  from: string;
  fromAddr: string; // empty for a sender inside the organisation (Exchange address)
  to: string;
  cc: string;
  subject: string;
  unread: boolean;
  importance: number; // 0 low, 1 normal, 2 high
  attach: number;
  body?: string;
}

export interface MailItem {
  id: string;
  from: string;
  addr?: string;
  to?: string;
  cc?: string;
  subject: string;
  received: string;
  unread: boolean;
  important?: boolean;
  /** what the model said, and which model */
  cls?: Bucket;
  why?: string;
  by?: string;
  /** arrived after the first look (the seed): an urgent one is announced */
  fresh?: boolean;
}

export interface MailState {
  items: MailItem[]; // newest first
  polled?: number; // when Outlook was last read
  me?: string; // the mailbox owner's name (for the prompt)
}

const KEEP_READ_MS = 3 * 864e5; // a mail that has been read stays listed (dimmed) this long
const MAX = 300;

/**
 * Fold one look at Outlook (the unread mail of the last `days`) into the state. What it returned is added or updated
 * (a new one is `fresh` unless this is the first look); a mail it no longer returns has been read (or moved) elsewhere.
 * Mail older than the window goes (0 = no window).
 */
export function merge(st: MailState, got: Fetched[], now: number, days = 0): MailState {
  const by = new Map(got.map((f) => [f.id, f]));
  const items: MailItem[] = st.items.map((m) => {
    const f = by.get(m.id);
    if (!f) return m.unread ? { ...m, unread: false } : m;
    by.delete(m.id);
    return f.unread === m.unread && f.subject === m.subject ? m : { ...m, unread: f.unread, subject: f.subject };
  });
  for (const f of by.values()) {
    items.push({
      id: f.id, from: f.from, addr: f.fromAddr || undefined, to: f.to.slice(0, 300), cc: f.cc.slice(0, 300) || undefined, subject: f.subject, received: f.received,
      unread: f.unread, important: f.importance === 2 || undefined, fresh: st.polled != null || undefined,
    });
  }
  const age = (m: MailItem) => now - Date.parse(m.received);
  const kept = items.filter((m) => (m.unread || age(m) < KEEP_READ_MS) && (!days || age(m) < days * 864e5));
  kept.sort((a, b) => b.received.localeCompare(a.received));
  return { ...st, items: kept.slice(0, MAX), polled: now };
}

/** ids whose body is not needed again (already sorted) */
export const knownOf = (st: MailState) => st.items.filter((m) => m.cls).map((m) => m.id);

/** a drawer tab per bucket (with how many are unread), and one for mail still being sorted */
export function tabsOf(st: MailState): ListDef[] {
  const n = (f: (m: MailItem) => boolean) => st.items.filter((m) => m.unread && f(m)).length;
  const tabs = BUCKETS.map((b) => {
    const c = n((m) => m.cls === b.id);
    return { id: b.id, label: c ? `${b.label} ${c}` : b.label };
  });
  const pending = st.items.filter((m) => !m.cls).length;
  return pending ? [...tabs, { id: 'pending', label: `Sorting… ${pending}` }] : tabs;
}

/** when it came: the time today, the weekday this week, else the date */
export function whenOf(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const t = new Date(now);
  if (d.toDateString() === t.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (now - d.getTime() < 6 * 864e5) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** the rows of a tab: unread first, newest first; read ones dimmed */
export function entriesOf(st: MailState, tab: string, now = Date.now()): Entry[] {
  const mine = st.items.filter((m) => (tab === 'pending' ? !m.cls : m.cls === tab));
  const order = [...mine.filter((m) => m.unread), ...mine.filter((m) => !m.unread)];
  return order.map((m) => ({
    ref: `mail:${m.id}`,
    title: m.subject || '(no subject)',
    sub: [m.from, m.why].filter(Boolean).join(' · '),
    lead: { text: whenOf(m.received, now) },
    text: `${m.subject || '(no subject)'} — ✉ ${m.from}`,
    dim: !m.unread,
    canInbox: true,
  }));
}
