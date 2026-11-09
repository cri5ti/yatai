/**
 * The poll loop (design/plugins.md §5–6). It asks each plugin about what is in Next (and the open drawer),
 * stores the snapshots, and turns what changed into highlights and toasts. Only the main window runs it.
 * It never imports the actions: the main window hands it a sink.
 */
import { get, set, subscribe, today, uid } from '../store';
import type { Node, State } from '../store';
import { fmt, prLinks, refsOf, setPrHost } from '../model';
import { PLUGINS, implFor, pluginById } from './registry';
import { AuthError, pluginOf } from './types';
import type { AgendaEvent, Alert, Impl, Plugin, Snapshot, Tone } from './types';
import { requests } from '../platform';
import { countRequest } from './requests';

export interface Sink {
  toast(text: string, tone: Tone): void;
  highlight(ids: string[]): void;
  /** a system notification, for items that asked to be told (`notify`) */
  notify?(title: string, body: string): void;
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
/**
 * what is new in `next` compared with `prev`: alerts that were not there, or a different state glyph.
 * Normally only what wants attention counts (not info alerts, not a move into a passing state such as "building");
 * with `all` (the item asked to be notified) every change of state does.
 */
export function changes(prev: Snapshot, next: Snapshot, all = false): { text: string; tone: Tone }[] {
  if (prev.rev === next.rev) return [];
  const fresh = next.alerts.filter((a: Alert) => a.tone !== 'info' && !prev.alerts.some((p) => p.key === a.key));
  if (fresh.length) return fresh.map((a) => ({ text: a.toast ?? `${next.name}: ${a.text}`, tone: a.tone }));
  if (prev.view.glyph !== next.view.glyph && (all || !next.view.quiet)) return [{ text: `${next.name}: ${next.view.label}`, tone: next.view.tone }];
  if (all) {
    const info = next.alerts.filter((a) => !prev.alerts.some((p) => p.key === a.key));
    if (info.length) return info.map((a) => ({ text: `${next.name}: ${a.text}`, tone: a.tone }));
  }
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

/**
 * What a source reports as outstanding inside a tracked item (a failing check, an unresolved review thread) is kept
 * as sub-items of that item, one per detail, marked with `origin`. A new one is added (and highlighted); one that is
 * no longer reported is checked off (and highlighted). Sub-items the user deleted come back only if reported anew.
 */
export function syncDetails(snaps: Snapshot[]) {
  let nodes = get().nodes;
  const touched: string[] = [];
  const now = Date.now();
  for (const sn of snaps) {
    if (!sn.details || sn.gone) continue;
    const parents = nodes.filter((n) => !n.origin && n.status !== 'done' && n.status !== 'dropped' && refsOf(n).includes(sn.ref));
    for (const p of parents) {
      const kids = nodes.filter((n) => n.parentId === p.id && n.origin?.startsWith(sn.ref + '|'));
      const want = new Set(sn.details.map((d) => `${sn.ref}|${d.key}`));
      const add: Node[] = sn.details
        .filter((d) => !kids.some((k) => k.origin === `${sn.ref}|${d.key}`))
        .map((d) => ({ id: uid(), parentId: p.id, title: d.url ? `${d.text}\n${d.url}` : d.text, status: 'todo', today: p.today, open: true, created: now, modified: now, origin: `${sn.ref}|${d.key}` }));
      const close = new Set(kids.filter((k) => !want.has(k.origin!) && k.status !== 'done' && k.status !== 'dropped').map((k) => k.id));
      if (close.size) nodes = nodes.map((n) => (close.has(n.id) ? { ...n, status: 'done', modified: now } : n));
      if (add.length) {
        // after the item's last descendant, so they read in the order reported
        const sub = new Set([p.id]);
        let at = nodes.findIndex((n) => n.id === p.id);
        nodes.forEach((n, i) => {
          if (n.parentId && sub.has(n.parentId)) (sub.add(n.id), (at = i));
        });
        nodes = [...nodes.slice(0, at + 1), ...add, ...nodes.slice(at + 1)];
      }
      touched.push(...add.map((n) => n.id), ...close);
    }
  }
  if (!touched.length) return;
  set(() => ({ nodes }));
  sink.highlight(touched);
}

export function applySnapshots(snaps: Snapshot[]) {
  describeBareLinks(snaps);
  syncDetails(snaps);
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
    const ids = nodesWith(s, sn.ref);
    const watched = s.nodes.some((n) => n.notify && ids.includes(n.id));
    const ch = changes(prev, sn, watched);
    if (ch.length) hl.push(...ids);
    ch.forEach((c) => sink.toast(c.text, c.tone));
    // asked to be told: also a system notification, unless yatai is in front of you
    if (watched && ch.length && (s.hidden || typeof document === 'undefined' || document.hidden || !document.hasFocus())) sink.notify?.(sn.name, ch.map((c) => c.text).join('\n'));
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
    const before = prev.get(m.id);
    if (!ev) {
      // it was on the calendar and is not any more (cancelled, or moved to another day)
      if (before) {
        sink.toast(`${m.title} is no longer on your calendar${m.day && m.day > today() ? ' on that day' : ' today'}`, 'warn');
        hl.push(m.id);
      }
      return m;
    }
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
  const base = implFor(p, s);
  if (!base) return;
  const impl = counted(p, base);
  const refs = trackedRefs(s).get(p.id) ?? [];
  const drawer = s.drawer?.kind === p.id ? s.drawer : null;
  try {
    if (impl.fetch && refs.length) applySnapshots(await impl.fetch(refs));
    if (impl.agenda) {
      // today's, and the days of meetings brought in ahead (to prepare), so a move there is noticed too
      const days = [...new Set([today(), ...s.meetings.map((m) => m.day).filter((d): d is string => !!d && d > today())])];
      const ev = (await Promise.all(days.map(async (d) => (await impl.agenda!(d)).map((e) => ({ ...e, day: d }))))).flat();
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

/** the mocks make no requests: count each of their calls as one, so the numbers mean something in the demo too */
const counted = (p: Plugin, impl: Impl): Impl =>
  impl !== p.mock
    ? impl
    : {
        ...impl,
        fetch: impl.fetch && ((refs, o) => (countRequest(p.id), impl.fetch!(refs, o))),
        list: impl.list && ((id) => (countRequest(p.id), impl.list!(id))),
        agenda: impl.agenda && ((d) => (countRequest(p.id), impl.agenda!(d))),
      };

/** look at these refs right now, whether or not their items are in Next (the item menu's Refresh) */
export async function refreshRefs(refs: string[]): Promise<Snapshot[]> {
  const by = new Map<string, string[]>();
  for (const r of refs) by.set(pluginOf(r), [...(by.get(pluginOf(r)) ?? []), r]);
  const out: Snapshot[] = [];
  await Promise.all(
    [...by].map(async ([id, rs]) => {
      const p = pluginById(id);
      const base = p && implFor(p, get());
      if (!p || !base?.fetch) return;
      const impl = counted(p, base);
      try {
        const snaps = await impl.fetch!(rs, { force: true });
        applySnapshots(snaps);
        out.push(...snaps);
      } catch (e) {
        if (e instanceof AuthError) set((st) => ({ accounts: { ...st.accounts, [id]: { ...st.accounts[id], state: 'expired' } } }));
        lastError.delete(id); // asked for: always say why
        oneError(id, e);
      }
    }),
  );
  return out;
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
  requests.count = countRequest;
  followHost();
  void refreshAccounts().then(() => cycle());
  setInterval(() => void cycle(undefined, false), 10_000);
  // something the plugins depend on changed: look again now
  let key = '';
  let host = get().settings.githubHost + '|' + get().settings.devopsOrg;
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
    if (st.settings.githubHost + '|' + st.settings.devopsOrg !== host) {
      host = st.settings.githubHost + '|' + st.settings.devopsOrg;
      void refreshAccounts().then(() => cycle());
    }
    if (k === key) return;
    key = k;
    void cycle();
  };
  return subscribe(watch);
}
