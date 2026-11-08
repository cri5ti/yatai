/**
 * The poll loop (spec/design/plugins.md §5–6). It asks each plugin about what is in Next (and the open drawer),
 * stores the snapshots, and turns what changed into highlights and toasts. Only the main window runs it.
 * It never imports the actions: the main window hands it a sink.
 */
import { get, set, subscribe, today } from '../store';
import type { State } from '../store';
import { fmt, prLinks, refsOf, setPrHost } from '../model';
import { PLUGINS, implFor, pluginById } from './registry';
import { AuthError, pluginOf } from './types';
import type { AgendaEvent, Alert, Plugin, Snapshot, Tone } from './types';

export interface Sink {
  toast(text: string, tone: Tone): void;
  highlight(ids: string[]): void;
}
let sink: Sink = { toast() {}, highlight() {} };

/** items to track: what is in Next and not finished, plus items explicitly bound to a source (`smart`: a work item, a run) */
export function trackedRefs(s: Pick<State, 'nodes'>): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const n of s.nodes) {
    if ((!n.today && !n.smart) || n.status === 'done' || n.status === 'dropped') continue;
    for (const r of refsOf(n)) {
      const id = pluginOf(r);
      by.set(id, [...new Set([...(by.get(id) ?? []), r])]);
    }
  }
  return by;
}
const nodesWith = (s: State, ref: string) => s.nodes.filter((n) => refsOf(n).includes(ref)).map((n) => n.id);

/* ---------- snapshots → changes ---------- */
/** what is new in `next` compared with `prev`: alerts that were not there, or a different state glyph */
export function changes(prev: Snapshot, next: Snapshot): { text: string; tone: Tone }[] {
  if (prev.rev === next.rev) return [];
  const fresh = next.alerts.filter((a: Alert) => a.tone !== 'info' && !prev.alerts.some((p) => p.key === a.key));
  if (fresh.length) return fresh.map((a) => ({ text: a.toast ?? `${next.name}: ${a.text}`, tone: a.tone }));
  if (prev.view.glyph !== next.view.glyph) return [{ text: `${next.name}: ${next.view.label}`, tone: next.view.tone }];
  return [];
}

/**
 * A bare pasted PR link (an item that is only the url) gets the PR's title and description: the title joins the
 * headline, the description becomes the note lines. Edit it afterwards as you like: it is only done for a bare link.
 */
function describeBareLinks(snaps: Snapshot[]) {
  const withDesc = new Map(snaps.filter((x) => x.desc !== undefined && !x.gone).map((x) => [x.ref, x]));
  if (!withDesc.size) return;
  const ids = new Set<string>();
  const nodes = get().nodes.map((n) => {
    if (n.title.includes('\n') || n.status === 'done') return n;
    const line = n.title.trim();
    const l = prLinks(line);
    const sn = l.length === 1 && l[0].url === line ? withDesc.get(`github:${l[0].key}`) : undefined;
    if (!sn) return n;
    ids.add(n.id);
    return { ...n, title: `${line} ${sn.title}${sn.desc ? `\n${sn.desc}` : ''}`, modified: Date.now() };
  });
  if (ids.size) set(() => ({ nodes }));
}

export function applySnapshots(snaps: Snapshot[]) {
  describeBareLinks(snaps);
  const s = get();
  const next = { ...s.snaps };
  const hl: string[] = [];
  let changed = false;
  for (const sn of snaps) {
    const prev = s.snaps[sn.ref];
    if (prev && prev.rev === sn.rev) continue;
    next[sn.ref] = sn;
    changed = true;
    if (sn.gone && !prev?.gone) sink.toast(sn.alerts[0]?.toast ?? sn.alerts[0]?.text ?? `${sn.name}: not found`, 'warn');
    if (!prev) continue; // the first time we hear of it is not a change
    const ch = changes(prev, sn);
    if (ch.length) hl.push(...nodesWith(s, sn.ref));
    ch.forEach((c) => sink.toast(c.text, c.tone));
  }
  if (changed) set(() => ({ snaps: next }));
  if (hl.length) sink.highlight(hl);
}

/** a calendar moved or cancelled a meeting that is in Next */
export function applyAgenda(plugin: string, events: AgendaEvent[], first: boolean) {
  const s = get();
  const prev = new Map((s.agenda[plugin] ?? []).map((e) => [e.id, e]));
  const hl: string[] = [];
  const meetings = s.meetings.map((m) => {
    const ev = events.find((e) => e.id === m.id);
    if (!ev) return m;
    const before = prev.get(m.id);
    if (before && before.start !== ev.start) {
      sink.toast(`${m.title} moved to ${fmt(ev.start)} (was ${fmt(before.start)})`, 'warn');
      hl.push(m.id);
      return { ...m, movedTo: ev.start === m.start ? undefined : ev.start };
    }
    if (before && !before.cancelled && ev.cancelled) {
      sink.toast(`${m.title} was cancelled`, 'warn');
      hl.push(m.id);
    }
    // a meeting saved as "moved" that the calendar says is not (older demo data): quietly settle
    if (first && m.movedTo != null && ev.start === m.start) return { ...m, movedTo: undefined };
    return m;
  });
  set(() => ({ agenda: { ...get().agenda, [plugin]: events }, ...(meetings.some((m, i) => m !== s.meetings[i]) ? { meetings } : {}) }));
  if (hl.length) sink.highlight(hl);
}

/* ---------- the loop ---------- */
const nextAt = new Map<string, number>();
const running = new Map<string, Promise<void>>();
const lastError = new Map<string, string>();
const seenAgenda = new Set<string>();

const oneError = (id: string, e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (lastError.get(id) !== msg) sink.toast(`${pluginById(id)?.name ?? id}: ${msg}`, 'warn');
  lastError.set(id, msg);
  console.warn(`yatai plugin ${id}:`, e);
};

async function runPlugin(p: Plugin) {
  const s = get();
  const impl = implFor(p, s);
  if (!impl) return;
  const refs = trackedRefs(s).get(p.id) ?? [];
  const drawer = s.drawer?.kind === p.id ? s.drawer : null;
  try {
    if (impl.fetch && refs.length) applySnapshots(await impl.fetch(refs));
    if (impl.agenda) {
      const ev = await impl.agenda(today());
      applyAgenda(p.id, ev, !seenAgenda.has(p.id));
      seenAgenda.add(p.id);
    }
    if (drawer && impl.list) {
      const key = `${p.id}/${drawer.tab}`;
      set((st) => ({ lists: { ...st.lists, [key]: { entries: st.lists[key]?.entries ?? [], at: st.lists[key]?.at ?? 0, error: st.lists[key]?.error, loading: true } } }));
      try {
        const entries = await impl.list(drawer.tab);
        set((st) => ({ lists: { ...st.lists, [key]: { entries, at: Date.now() } } }));
      } catch (e) {
        if (e instanceof AuthError) {
          set((st) => ({ lists: { ...st.lists, [key]: { ...st.lists[key], entries: st.lists[key]?.entries ?? [], at: st.lists[key]?.at ?? 0, loading: false } } }));
          throw e;
        }
        set((st) => ({ lists: { ...st.lists, [key]: { entries: st.lists[key]?.entries ?? [], at: Date.now(), error: e instanceof Error ? e.message : String(e) } } }));
      }
    }
    lastError.delete(p.id);
  } catch (e) {
    if (e instanceof AuthError) {
      set((st) => ({ accounts: { ...st.accounts, [p.id]: { ...st.accounts[p.id], state: 'expired' } } }));
      oneError(p.id, e);
    } else {
      oneError(p.id, e);
    }
  }
}

/** run one cycle for a plugin (or all), now or when it is due */
export function cycle(only?: string, force = true): Promise<void> {
  const now = Date.now();
  const jobs = PLUGINS.filter((p) => (!only || p.id === only) && implFor(p, get()) && (force || (nextAt.get(p.id) ?? 0) <= now)).map((p) => {
    const hidden = get().hidden;
    nextAt.set(p.id, now + (hidden ? p.pollMs.idle : p.pollMs.active));
    const prev = running.get(p.id) ?? Promise.resolve();
    const job = prev.then(() => runPlugin(p)).finally(() => running.get(p.id) === job && running.delete(p.id));
    running.set(p.id, job);
    return job;
  });
  return Promise.all(jobs).then(() => undefined);
}
export const refreshNow = (only?: string) => cycle(only, true);

/** which accounts have a token, and who they are (asks the service once; a failed network leaves them connected) */
export async function refreshAccounts() {
  for (const p of PLUGINS) {
    if (!p.auth) continue;
    try {
      if (!(await p.auth.configured())) {
        set((s) => ({ accounts: { ...s.accounts, [p.id]: { state: 'none' } } }));
        continue;
      }
    } catch {
      continue;
    }
    set((s) => ({ accounts: { ...s.accounts, [p.id]: { state: 'connected', as: s.accounts[p.id]?.as } } }));
    try {
      const as = await p.auth.who();
      set((s) => ({ accounts: { ...s.accounts, [p.id]: { state: 'connected', as } } }));
    } catch (e) {
      if (e instanceof AuthError) set((s) => ({ accounts: { ...s.accounts, [p.id]: { state: 'expired' } } }));
    }
  }
}

export async function connectAccount(id: string, token: string): Promise<string> {
  const p = pluginById(id);
  if (!p?.auth) throw new Error('no such account');
  const as = await p.auth.connect(token.trim());
  lastError.delete(id);
  set((s) => ({ accounts: { ...s.accounts, [id]: { state: 'connected', as } } }));
  return as;
}
export async function disconnectAccount(id: string) {
  const p = pluginById(id);
  if (!p?.auth) return;
  await p.auth.disconnect();
  set((s) => ({ accounts: { ...s.accounts, [id]: { state: 'none' } }, snaps: Object.fromEntries(Object.entries(s.snaps).filter(([r]) => pluginOf(r) !== id)), lists: {} }));
}

/** the GitHub host whose links are recognised follows Settings (main window and popups alike) */
export function followHost() {
  const sync = () => setPrHost(get().settings.githubHost);
  sync();
  return subscribe(sync);
}

/** start the loop in the main window */
export function startTracker(s: Sink) {
  sink = s;
  followHost();
  void refreshAccounts().then(() => cycle());
  setInterval(() => void cycle(undefined, false), 10_000);
  // something the plugins depend on changed: look again now
  let key = '';
  let host = get().settings.githubHost;
  let nodes: State['nodes'] | null = null;
  let refs = '';
  const watch = () => {
    const st = get();
    if (st.nodes !== nodes) {
      nodes = st.nodes;
      refs = [...trackedRefs(st)].map(([id, r]) => `${id}=${r.join(',')}`).sort().join(';');
    }
    const need = PLUGINS.filter((p) => implFor(p, st)?.agenda && !st.agenda[p.id]).map((p) => p.id).join(',');
    const k = [refs, st.drawer ? `${st.drawer.kind}/${st.drawer.tab}` : '', st.demo, JSON.stringify(st.accounts), need].join('|');
    if (st.settings.githubHost !== host) {
      host = st.settings.githubHost;
      void refreshAccounts().then(() => cycle());
    }
    if (k === key) return;
    key = k;
    void cycle();
  };
  return subscribe(watch);
}
