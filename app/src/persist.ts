/**
 * Saving and loading the document.
 *  - Desktop app: SQLite (src-tauri/src/db.rs). The store is immutable, so an item that did not change keeps
 *    its object identity: each save sends only the rows that changed (or moved) and the ids that went away.
 *  - Browser build: one JSON blob in localStorage, like the POC.
 * UI preferences (layout, tab, theme, highlights, PR statuses …) are one JSON value in the `kv` table.
 */
import { invoke, isTauri } from './platform';
import { DEFAULT_SETTINGS, TRANSIENT, initialState, onStateChange, replaceState } from './store';
import type { Doc, InboxItem, Meeting, Node, Seg, State } from './store';

/** state that is saved besides the document (everything not in TRANSIENT and not part of Doc) */
const UI_KEYS = [
  'flags', 'clock', 'clockSpeed', 'clockManual', 'day', 'demo', 'settings', 'layout', 'prevLayout', 'tab', 'focus', 'focusSpeed', 'dark',
  'prs', 'prc', 'snaps', 'agenda', 'hl', 'bounds', 'scale', 'density', 'showApps', 'aiDelay', 'sel', 'nsel', 'isel', 'expanded',
] as const satisfies readonly (keyof State)[];
/** (the real-time clock is not worth a write every 15 s: only a simulated one is kept) */
const uiOf = (s: State) => Object.fromEntries(UI_KEYS.filter((k) => k !== 'clock' || s.clockManual || s.clockSpeed).map((k) => [k, s[k]]));

/* ---------- rows ↔ objects ---------- */
type Row = Record<string, unknown>;
const json = (v: unknown) => (v == null ? null : JSON.stringify(v));
const parse = <T,>(v: unknown): T | undefined => {
  if (typeof v !== 'string') return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
};
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
/** drop undefined so a loaded object looks like one made in the app */
const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const T = {
  item: {
    to: (n: Node, ord: number): Row => ({
      id: n.id, ord, parent_id: n.parentId, title: n.title, status: n.status, today: n.today, open: n.open, created: n.created, modified: n.modified,
      last_run: n.lastRun ?? null, scheduled: n.scheduled ?? null, est: n.est ?? null, due: n.due ?? null, later: n.later ?? null, spent: n.spent ?? null,
      smart: json(n.smart),
    }),
    from: (r: Row): Node =>
      tidy({
        id: r.id as string, parentId: (r.parent_id as string) ?? null, title: (r.title as string) ?? '', status: (r.status as Node['status']) ?? 'todo',
        today: !!r.today, open: r.open == null ? true : !!r.open, created: num(r.created) ?? Date.now(), modified: num(r.modified) ?? Date.now(),
        lastRun: num(r.last_run), scheduled: num(r.scheduled), est: num(r.est), due: str(r.due), later: num(r.later), spent: num(r.spent),
        smart: parse<Node['smart']>(r.smart),
      }),
  },
  inbox: {
    to: (i: InboxItem, ord: number): Row => ({ id: i.id, ord, text: i.text, created: i.created, suggestion: json(i.suggestion) }),
    from: (r: Row): InboxItem => tidy({ id: r.id as string, text: (r.text as string) ?? '', created: num(r.created) ?? Date.now(), suggestion: parse<InboxItem['suggestion']>(r.suggestion) }),
  },
  meeting: {
    to: (m: Meeting, ord: number): Row => ({
      id: m.id, ord, day: m.day ?? null, title: m.title, start: m.start, moved_to: m.movedTo ?? null, duration_min: m.durationMin, location: m.where, open: m.open ?? null,
    }),
    from: (r: Row): Meeting =>
      tidy({
        id: r.id as string, day: str(r.day), title: (r.title as string) ?? '', start: num(r.start) ?? 0, movedTo: num(r.moved_to), durationMin: num(r.duration_min) ?? 30,
        where: (r.location as string) ?? '', open: r.open == null ? undefined : !!r.open,
      }),
  },
  plan_seg: {
    to: (g: Seg, ord: number): Row => ({ id: g.id, ord, owner: g.owner, items: JSON.stringify(g.items), keep: g.keep ?? null, pulled: g.pulled ?? null }),
    from: (r: Row): Seg =>
      tidy({ id: r.id as string, owner: r.owner as string, items: parse<string[]>(r.items) ?? [], keep: r.keep == null ? undefined : !!r.keep, pulled: r.pulled == null ? undefined : !!r.pulled }),
  },
};
const LISTS = [
  ['item', 'nodes'],
  ['inbox', 'inbox'],
  ['meeting', 'meetings'],
  ['plan_seg', 'plan'],
] as const;

/* ---------- what is on disk now ---------- */
type Saved = { lists: Record<string, Map<string, { obj: unknown; ord: number }>>; ui: string; current: string };
let saved: Saved = { lists: {}, ui: '', current: '' };
const snapshot = (s: State): Saved => ({
  lists: Object.fromEntries(LISTS.map(([t, k]) => [t, new Map((s[k] as { id: string }[]).map((o, ord) => [o.id, { obj: o, ord }]))])),
  ui: JSON.stringify(uiOf(s)),
  current: JSON.stringify(s.current),
});

type Op = { t: string; put?: Row; del?: string };
function diff(prev: Saved, next: Saved, s: State): Op[] {
  const ops: Op[] = [];
  for (const [t, k] of LISTS) {
    const before = prev.lists[t] ?? new Map();
    const after = next.lists[t];
    const to = T[t].to as (o: unknown, ord: number) => Row;
    (s[k] as { id: string }[]).forEach((o, ord) => {
      const b = before.get(o.id);
      if (!b || b.obj !== o || b.ord !== ord) ops.push({ t, put: to(o, ord) });
    });
    for (const id of before.keys()) if (!after.has(id)) ops.push({ t, del: id });
  }
  if (prev.ui !== next.ui) ops.push({ t: 'kv', put: { key: 'ui', value: next.ui } });
  if (prev.current !== next.current) ops.push({ t: 'kv', put: { key: 'current', value: next.current } });
  return ops;
}

/* ---------- saving ---------- */
const WEB_KEY = 'yatai-app-v1';
let timer: ReturnType<typeof setTimeout> | null = null;
let latest: State | null = null;
let writing: Promise<void> = Promise.resolve();
let failed = false;

async function write() {
  timer = null;
  const s = latest;
  if (!s) return;
  latest = null;
  if (!isTauri) {
    try {
      localStorage.setItem(WEB_KEY, JSON.stringify({ ...s, ...TRANSIENT }));
    } catch {
      /* full / private mode */
    }
    return;
  }
  const next = snapshot(s);
  const ops = diff(saved, next, s);
  if (!ops.length) return;
  try {
    await invoke('db_apply', { ops });
    saved = next;
    failed = false;
  } catch (e) {
    // keep `saved` as it was: the next save retries these rows
    if (!failed) console.error('yatai: saving failed', e);
    failed = true;
  }
}

/** called on every state change: save shortly after, in order */
function schedule(s: State) {
  latest = s;
  if (!timer) timer = setTimeout(() => (writing = writing.then(write)), 250);
}

/** write whatever is pending now (before hiding / quitting) */
export async function flush() {
  if (timer) {
    clearTimeout(timer);
    writing = writing.then(write);
  }
  await writing;
}

/* ---------- loading ---------- */
export async function loadState(): Promise<void> {
  const base = initialState();
  let next: State = base;
  if (!isTauri) {
    try {
      const raw = localStorage.getItem(WEB_KEY);
      if (raw) next = { ...base, ...JSON.parse(raw), ...TRANSIENT };
    } catch {
      /* corrupt: start over */
    }
  } else {
    const data = await invoke<Record<string, Row[]>>('db_load');
    const kv = Object.fromEntries((data.kv ?? []).map((r) => [r.key as string, r.value as string]));
    const doc: Doc = {
      nodes: (data.item ?? []).map(T.item.from),
      inbox: (data.inbox ?? []).map(T.inbox.from),
      meetings: (data.meeting ?? []).map(T.meeting.from),
      plan: (data.plan_seg ?? []).map(T.plan_seg.from),
      current: parse(kv.current) ?? null,
    };
    next = { ...base, ...(parse<Partial<State>>(kv.ui) ?? {}), ...doc, ...TRANSIENT };
    saved = snapshot(next); // exactly what is on disk
  }
  next = { ...next, settings: { ...DEFAULT_SETTINGS, ...next.settings } };
  replaceState(next);
  onStateChange(schedule);
}

export const dbPath = () => (isTauri ? invoke<string>('db_path') : Promise.resolve('localStorage'));
