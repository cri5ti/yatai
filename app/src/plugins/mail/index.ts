/**
 * Emails: the Inbox of the classic Outlook on this PC (COM, through src-tauri/src/mail.rs), sorted on this machine
 * into Urgent / Today / Eventually / Dismiss by a Laya decision model (or, for comparison, an Ollama LLM). Read-only: nothing is marked read or moved in Outlook.
 * It looks at the unread mail of the last N days in the folders picked in Settings → Emails (the user's own mailbox
 * only, none until some are picked; at most 200). Each mail is sorted once.
 */
import { get, set } from '../../store';
import { isTauri, mailFetch } from '../../platform';
import type { Impl, ListState, Notice, Plugin } from '../types';
import { classify, sorterOf } from './classify';
import { BUCKETS, entriesOf, knownOf, merge, tabsOf } from './model';
import type { Fetched, MailState } from './model';
import { mock } from './mock';

const ID = 'mail';
/** how long one cycle may spend sorting (the rest waits for the next one) */
const BUDGET_MS = 45_000;

/** bodies of mail not sorted yet: only needed once, so not saved */
const bodies = new Map<string, string>();
let lastModelError = '';
/** picked folders Outlook does not have (renamed, deleted): Settings shows them */
export let missing: string[] = [];

/** keep the drawer's tabs in step with the state as each mail is sorted, not only at the end of a cycle */
function save(mail: MailState) {
  const at = Date.now();
  set((s) => {
    const lists: Record<string, ListState> = { ...s.lists };
    for (const t of [...BUCKETS.map((b) => b.id), 'pending']) lists[`${ID}/${t}`] = { entries: entriesOf(mail, t, at), at };
    return { mail, lists };
  });
}

async function look(): Promise<MailState> {
  const st = get().mail;
  const days = get().settings.mailDays ?? 14;
  const folders = get().settings.mailFolders ?? [];
  // nothing picked (the default): nothing is read
  if (!folders.length) {
    const next = { ...st, items: [], polled: Date.now() };
    save(next);
    return next;
  }
  const raw = await mailFetch(ID, { days, limit: 200, known: knownOf(st), folders });
  const res = JSON.parse(raw) as { error?: string; me?: string; missing?: string[]; items?: Fetched[] };
  if (res.error) throw new Error(`Outlook: ${res.error}`);
  for (const f of res.items ?? []) if (f.body != null) bodies.set(f.id, f.body);
  if (res.missing?.length) missing = res.missing;
  else missing = [];
  const next = { ...merge(get().mail, res.items ?? [], Date.now(), days, folders), me: res.me || st.me };
  save(next);
  return next;
}

async function sort(): Promise<Notice[]> {
  const out: Notice[] = [];
  const t0 = Date.now();
  const cfg = get().settings;
  for (;;) {
    const st = get().mail;
    const m = st.items.find((x) => !x.cls);
    if (!m || Date.now() - t0 > BUDGET_MS) break;
    let r;
    try {
      r = await classify(cfg, st.me ?? '', { ...m, body: bodies.get(m.id) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== lastModelError) out.push({ text: `Emails: ${msg}`, tone: 'warn' });
      lastModelError = msg;
      break;
    }
    lastModelError = '';
    bodies.delete(m.id);
    const cur = get().mail;
    save({ ...cur, items: cur.items.map((x) => (x.id === m.id ? { ...x, ...r, by: sorterOf(cfg) } : x)) });
    if (m.fresh && m.unread && r.cls === 'urgent') out.push({ text: `Urgent email from ${m.from}: ${m.subject}`, tone: 'bad' });
  }
  return out;
}

const live: Impl = {
  get lists() {
    return tabsOf(get().mail);
  },
  async list(id) {
    return entriesOf(get().mail, id);
  },
  async poll() {
    await look();
    return sort();
  },
};

/** forget how everything was sorted (another model, a better prompt): it is all sorted again over the next cycles */
export function resort(s: MailState): MailState {
  return { ...s, items: s.items.map(({ cls: _c, why: _w, by: _b, p: _p, reply: _r, ...m }) => m) };
}

export const mail: Plugin = {
  id: ID,
  name: 'Emails',
  live: isTauri ? live : undefined,
  mock,
  pollMs: { active: 2 * 60_000, idle: 5 * 60_000 },
};
