import { countItems } from './clip';
import { planEdit, scopeFor } from './mdedit';
import type { ClipItem } from './clip';
import { DENSITIES, SCALES, commit, demoDoc, docOf, emptyDoc, get, minutesNow, onBlocked, resetDoc, seedInbox, set, today, uid } from './store';
import { AI_CFG, chatTurn, noteToModel, refreshAiKey, resetConvo, stopTurn } from './ai';
import { acceptProposal, rejectProposal } from './proposal';
import type { BuildStatus, Chip, Current, Doc, Meeting, DrawerKind, Flags, PrStatus, FocusState, Layout, Node, Seg, State, Status, Tab, Toast } from './store';
import { aiBreakdown, aiEstimate, aiPlan, aiReply, aiSuggest, sleep } from './mock';
import { implFor, pluginById } from './plugins/registry';
import { placedAt } from './popupguard';
import { connectAccount, disconnectAccount, refreshAccounts, refreshNow, refreshRefs } from './plugins/tracker';
import { grant, signOut } from './plugins/entra';
import type { Source } from './plugins/entra';
import { resort } from './plugins/mail';
import type { Snapshot } from './plugins/types';
import { FX, ROOT, effSel, fmt, plain, hasKids, isUnder, isoDay, leavesOf, meetingsFor, nextModel, reconcilePlan, refsOf, startable } from './model';
import type { CardM } from './model';
import { focusArea, stepEst } from './kbd';
import { PRESETS, remindLabel } from './remind';
import { quietFlip } from './flip';
import { flush } from './persist';
import { invoke } from './platform';

/* ---------- toasts ---------- */
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = uid();
  set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => dismissToast(id), 5000);
}

/** install the downloaded update: write what is pending first (the installer ends the app) */
export async function installUpdate() {
  try {
    await flush();
    await invoke('update_install');
  } catch (e) {
    toast(`Update failed: ${String(e)}`, 'bad');
  }
}
export const dismissToast = (id: string) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/* ---------- navigation / window ---------- */
/** the layout to go back to from the pill (never the pill itself) */
const backFromPill = (s: State): Layout => (s.prevLayout && s.prevLayout !== 'pill' ? s.prevLayout : 'dock');
/** switching tabs from the idle pill brings the full window back */
export const setTab = (tab: Tab) =>
  set((s) => ({ tab, hidden: false, menu: null, edit: null, ins: null, multi: [], anchor: null, ...(s.layout === 'pill' && !s.focus ? { layout: backFromPill(s) } : {}) }));
export const setLayout = (layout: Layout) =>
  set((s) => ({ layout, hidden: false, prevLayout: layout === 'pill' && s.layout !== 'pill' ? s.layout : s.prevLayout }));
/** out of the idle pill, back to the layout it came from */
export const leavePill = () => set((s) => (s.layout === 'pill' && !s.focus ? { layout: backFromPill(s), hidden: false } : {}));
export const setBounds = (layout: 'dock' | 'float' | 'max', r: { x: number; y: number; w: number; h: number; p?: { x: number; y: number; w: number; h: number } } | null) =>
  set((s) => {
    const b = { ...s.bounds };
    if (r) b[layout] = r;
    else delete b[layout];
    return { bounds: b };
  });
export const toggleOnTop = () => set((s) => ({ onTop: !s.onTop }));
export const toggleHidden = () => set((s) => ({ hidden: !s.hidden }));
export const openCapture = () => set(() => ({ capture: true }));
export const closeCapture = () => set(() => ({ capture: false }));
export const closeMenu = () => {
  set(() => ({ menu: null }));
  focusArea();
};
export const setScale = (i: number) => (quietFlip(), set(() => ({ scale: Math.max(0, Math.min(SCALES.length - 1, i)) })));
export const setDensity = (i: number) => (quietFlip(), set(() => ({ density: Math.max(0, Math.min(DENSITIES.length - 1, i)) })));
/* ---------- highlights: changes the user did not make ---------- */
/* ---------- reminders (/remind) ---------- */
/** come back to these items at `at` (ms); null clears */
export function setRemind(ids: string[], at: number | null) {
  patchNodes(at ? 'Remind' : 'Clear reminder', ids, { remind: at ?? undefined });
  toast(at ? `Reminder ${remindLabel(at)}${ids.length > 1 ? ` for ${ids.length} items` : ''}` : 'Reminder cleared', at ? 'good' : 'info');
}
export const remindIn = (ids: string[], preset: string) => {
  const p = PRESETS.find((x) => x.id === preset);
  if (p) setRemind(ids, p.at(new Date(), get().settings.workStart).getTime());
};
/**
 * The main window looks every few seconds: a reminder that came (or came while yatai was closed) brings its item into
 * Next, highlights it and says so (a toast, and a system notification unless yatai is in front). Not an undo step.
 * Done or abandoned items just lose the reminder.
 */
export function fireReminders(now = Date.now(), notify?: (title: string, body: string) => void) {
  const due = get().nodes.filter((n) => n.remind != null && n.remind <= now);
  if (!due.length) return;
  const ids = new Set(due.map((n) => n.id));
  const live = due.filter((n) => n.status !== 'done' && n.status !== 'dropped');
  const back = new Set(live.map((n) => n.id));
  set((s) => ({ nodes: s.nodes.map((n) => (!ids.has(n.id) ? n : back.has(n.id) ? { ...n, remind: undefined, today: true, later: undefined, modified: now } : { ...n, remind: undefined })) }));
  if (!live.length) return;
  highlight(live.map((n) => n.id));
  const names = live.map((n) => plain(n.title.split('\n')[0]));
  toast(live.length === 1 ? `⏰ ${names[0]}` : `⏰ ${live.length} reminders: ${names.join(' · ')}`, 'warn');
  const s = get();
  if (notify && (s.hidden || typeof document === 'undefined' || document.hidden || !document.hasFocus())) notify('Reminder', names.join('\n'));
}

/** mark things yellow until the mouse passes over them */
export function highlight(ids: string[]) {
  if (!ids.length) return;
  set((s) => ({ hl: { ...s.hl, ...Object.fromEntries(ids.map((id) => [id, true as const])) } }));
}
export function dismissHl(ids: string[]) {
  const hl = get().hl;
  if (!ids.some((id) => hl[id])) return;
  set((s) => {
    const next = { ...s.hl };
    ids.forEach((id) => delete next[id]);
    return { hl: next };
  });
}

/** developer panel: the MOCK GitHub now says this about a PR; the tracker picks it up like any change */
export function setPrStatus(key: string, status: PrStatus) {
  if ((get().prs[key] ?? 'review') === status) return;
  set((s) => ({ prs: { ...s.prs, [key]: status } }));
  void refreshNow('github');
}

/** the Calendar drawer: list ↔ day schedule */
export const setOutlookView = (v: 'list' | 'day') => set(() => ({ outlookView: v }));
/** a popup window was moved / resized by the user: remember it under its key (the main window's own placing is ignored) */
export function setPopupRect(view: string, key: string, r: { x: number; y: number; w: number; h: number }) {
  if (Date.now() - (placedAt[view] ?? 0) < 1200) return;
  set((s) => ({ popups: { ...s.popups, [key]: r } }));
}
/** the item menu's Refresh: ask the sources about these items now */
export async function refreshItems(ids: string[]) {
  const refs = [...new Set(get().nodes.filter((n) => ids.includes(n.id)).flatMap((n) => refsOf(n)))];
  if (!refs.length) return toast('Nothing here comes from GitHub or DevOps', 'info');
  toast('Refreshing…', 'info');
  const snaps = await refreshRefs(refs);
  if (!snaps.length) return;
  toast(snaps.length === 1 ? `${snaps[0].name}: ${snaps[0].view.label}` : `Refreshed ${snaps.length} items`, 'info');
}
/** developer panel: the mock DevOps moves a pipeline run on */
export function setRunStatus(ref: string, status: BuildStatus) {
  set((s) => ({ runs: { ...s.runs, [ref]: status } }));
  void refreshNow('devops');
}
/** ask to be told about every change of what these items track (or stop); one undo step */
export function toggleNotify(ids: string[]) {
  const nodes = get().nodes.filter((n) => ids.includes(n.id) && refsOf(n).length);
  if (!nodes.length) return toast('Nothing here is tracked: paste a PR or pipeline link into it first', 'info');
  const on = !nodes.every((n) => n.notify);
  patchNodes(on ? 'Notify on changes' : 'Stop notifying', nodes.map((n) => n.id), { notify: on || undefined });
  toast(on ? 'You will be notified when it changes' : 'No more notifications for it', 'info');
}
export function setPrComments(key: string, n: number) {
  if (get().prc[key] === n) return;
  set((s) => ({ prc: { ...s.prc, [key]: n } }));
  void refreshNow('github');
}

/* ---------- meetings: delete here, bring back from the Calendar drawer ---------- */
export function removeMeeting(id: string) {
  const m = get().meetings.find((x) => x.id === id);
  if (!m) return;
  commit('Delete meeting', (s) => {
    // only the meeting goes: whatever was inside it stays in Next as top-level items
    return {
      meetings: s.meetings.filter((x) => x.id !== id),
      nodes: s.nodes.map((n) => (n.parentId === id ? { ...n, parentId: null, today: true } : n)),
      plan: s.plan.filter((sg) => sg.owner !== id),
      multi: [],
    };
  });
  toast(`${m.title} removed — bring it back from the Calendar drawer`, 'info');
}
/** a meeting into Next: today's from the agenda; one ahead (to prepare) comes with its data and its day */
export function bringMeeting(id: string, ahead?: { id: string; title: string; start: number; durationMin: number; where: string; day: string }) {
  const e = ahead ?? Object.values(get().agenda).flat().find((x) => x.id === id);
  if (!e || get().meetings.some((x) => x.id === id)) return;
  const day = ahead?.day ?? today();
  const m: Meeting = { id: e.id, title: e.title, start: e.start, durationMin: e.durationMin, where: e.where, day };
  commit('Bring in meeting', (s) => ({ meetings: [...s.meetings, m] }));
  toast(ahead && day !== today() ? `${m.title} is in Next (${new Date(day + 'T00:00').toLocaleDateString(undefined, { weekday: 'long' })}): add your prep under it` : `${m.title} is back in Next`, 'good');
}

/* ---------- the Calendar / GitHub / DevOps / Emails drawers ---------- */
export const openDrawer = (kind: DrawerKind) =>
  set((s) => {
    const p = pluginById(kind);
    const tab = ((p && implFor(p, s)?.lists) ?? p?.live?.lists ?? p?.mock?.lists ?? [])[0]?.id ?? '';
    return { drawer: s.drawer?.kind === kind ? null : { kind, tab, sel: 0 }, menu: null };
  });
export const closeDrawer = () => {
  set(() => ({ drawer: null }));
  focusArea();
};
export const setDrawerTab = (tab: string) => set((s) => (s.drawer ? { drawer: { ...s.drawer, tab, sel: 0 } } : {}));
/** ⌘R in a drawer, or a button: look again now */
export const refreshDrawer = () => void refreshNow(get().drawer?.kind);
export const setDrawerSel = (sel: number) => set((s) => (s.drawer ? { drawer: { ...s.drawer, sel } } : {}));

/** pull something from a source into yatai: straight into Next, or into the Inbox to triage later */
export function bringIn(spec: { title: string; ref?: string; smart?: string; snap?: Snapshot }, to: 'next' | 'inbox') {
  if (to === 'inbox') {
    capture(spec.title);
    return toast('Added to the Inbox', 'good');
  }
  const smart = spec.smart ? { source: spec.smart as NonNullable<Node['smart']>['source'], ref: spec.ref } : undefined;
  const s0 = get();
  // under the current item; beside it when that is itself something brought in (a PR, a work item…)
  const cur = currentItem(s0);
  const sib = cur && typeof cur !== 'string' && (!!cur.smart || refsOf(cur).length > 0) ? cur : null;
  const parentId = !cur ? null : typeof cur === 'string' ? cur : sib ? sib.parentId : cur.id;
  const node = mk(parentId, spec.title, { today: true, smart, status: smart ? 'waiting' : 'todo' });
  const sn = spec.snap;
  const key = sn?.ref.startsWith('github:') ? sn.ref.slice(7) : null;
  commit('Bring in', (s) => {
    const after = sib ? sib.id : parentId ? lastChild(s.nodes, parentId) ?? parentId : null;
    const nodes = openIt(insertAfter(s.nodes, node, after), parentId);
    let plan = planOf({ ...s, nodes });
    // beside a row of a card: right after it, not at the end of the card
    const si = sib ? segOf(plan, sib.id) : -1;
    if (sib && si >= 0 && segOf(plan, node.id) >= 0) {
      plan = plan.map((sg) => ({ ...sg, items: sg.items.filter((x) => x !== node.id) }));
      const items = [...plan[si].items];
      items.splice(items.indexOf(sib.id) + 1, 0, node.id);
      plan = reconcilePlan(withItems(plan, si, items), nodes, s.meetings);
    }
    return {
      nodes,
      plan,
      snaps: sn && !s.snaps[sn.ref] ? { ...s.snaps, [sn.ref]: sn } : s.snaps,
      // the mock GitHub has to agree with what the drawer showed
      prs: key && !s.prs[key] ? { ...s.prs, [key]: sn!.view.glyph as PrStatus } : s.prs,
      prc: key && sn!.view.count != null && s.prc[key] == null ? { ...s.prc, [key]: sn!.view.count } : s.prc,
      // …and so does the mock DevOps
      runs: sn?.ref.startsWith('devops:build/') && !s.runs[sn.ref] ? { ...s.runs, [sn.ref]: sn.view.glyph as BuildStatus } : s.runs,
      nsel: { card: null, row: node.id },
      sel: s.tab === 'organizer' ? node.id : s.sel,
      multi: [],
    };
  });
  const under = parentId && (s0.nodes.find((n) => n.id === parentId)?.title ?? s0.meetings.find((m) => m.id === parentId)?.title);
  toast(under ? `Added to Next, under ${plain(under.split('\n')[0])}` : 'Added to Next', 'good');
}

/** the item the user is on: the Organizer's selection, or the row picked in Next (a meeting id for its calendar row) */
function currentItem(s: State): Node | string | null {
  if (s.tab === 'organizer') return s.nodes.find((n) => n.id === s.sel) ?? null;
  const cards = nextModel(s).cards;
  const sel = effSel(cards, s.nsel);
  const c = cards.find((x) => x.key === sel.card);
  if (!c) return null;
  const r = sel.row ? c.rows.find((x) => x.id === sel.row) : undefined;
  if (r?.fx) return r.fx.id;
  return r?.node ?? c.task ?? (c.kind === 'meeting' ? c.ownerId : null);
}

export const toggleHelp = () => set((s) => ({ help: !s.help }));
export const pick = (card: string | null, row: string | null) => set(() => ({ nsel: { card, row }, multi: [], anchor: null }));
export const setMulti = (ids: string[], anchor: string | null) => set(() => ({ multi: ids, anchor }));
export const setExpanded = (id: string, v: boolean) => set((s) => ({ expanded: { ...s.expanded, [id]: v } }));

/* ---------- undo / redo ---------- */
/** items an undo/redo brings back are highlighted: they may reappear where the user is not looking */
function appeared(next: Doc) {
  const have = new Set(get().nodes.map((n) => n.id));
  highlight(next.nodes.filter((n) => !have.has(n.id)).map((n) => n.id));
}
export function undo() {
  const e = get().past.at(-1);
  if (!e) return toast('Nothing to undo');
  appeared(e.doc);
  set((s) => ({ ...e.doc, past: s.past.slice(0, -1), future: [{ label: e.label, doc: docOf(s) }, ...s.future] }));
  toast(`Undid: ${e.label}`);
}
export function redo() {
  const e = get().future[0];
  if (!e) return toast('Nothing to redo');
  appeared(e.doc);
  set((s) => ({ ...e.doc, future: s.future.slice(1), past: [...s.past, { label: e.label, doc: docOf(s) }] }));
  toast(`Redid: ${e.label}`);
}

/* ---------- item helpers (pure) ---------- */
const mk = (parentId: string | null, title: string, extra: Partial<Node> = {}): Node => ({
  id: uid(),
  parentId,
  title,
  status: 'todo',
  today: false,
  open: true,
  created: Date.now(),
  modified: Date.now(),
  ...extra,
});

export function subtree(nodes: Node[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) (ids.add(n.id), (grew = true));
  }
  return ids;
}
export const subtreeIds = (nodes: Node[], ids: string[]) => {
  const out = new Set<string>();
  ids.forEach((id) => subtree(nodes, id).forEach((x) => out.add(x)));
  return out;
};
/** index of the last node of id's subtree */
const subtreeEnd = (nodes: Node[], id: string) => {
  const sub = subtree(nodes, id);
  let idx = -1;
  nodes.forEach((n, i) => {
    if (sub.has(n.id)) idx = i;
  });
  return idx;
};
/** insert after `afterId` and its whole subtree (keeps sibling order intact) */
function insertAfter(nodes: Node[], node: Node, afterId?: string | null): Node[] {
  const out = [...nodes];
  const idx = afterId ? subtreeEnd(nodes, afterId) : -1;
  if (idx < 0) out.push(node);
  else out.splice(idx + 1, 0, node);
  return out;
}
/** insert immediately above `beforeId` */
function insertBefore(nodes: Node[], node: Node, beforeId: string): Node[] {
  const out = [...nodes];
  const idx = out.findIndex((n) => n.id === beforeId);
  if (idx < 0) out.push(node);
  else out.splice(idx, 0, node);
  return out;
}
const lastChild = (nodes: Node[], pid: string) => [...nodes].reverse().find((n) => n.parentId === pid)?.id ?? null;
const openIt = (nodes: Node[], id: string | null) => nodes.map((n) => (n.id === id && !n.open ? { ...n, open: true } : n));

/** move a subtree: under `parentId`, before / after a sibling, or at the end of the parent's children */
type Place = { before: string } | { after: string } | { end: true };
function relocate(nodes: Node[], id: string, parentId: string | null, at: Place): Node[] {
  const sub = subtree(nodes, id);
  const moved = nodes.filter((n) => sub.has(n.id)).map((n) => (n.id === id ? { ...n, parentId, modified: Date.now() } : n));
  const rest = nodes.filter((n) => !sub.has(n.id));
  let idx: number;
  if ('before' in at) idx = rest.findIndex((n) => n.id === at.before);
  else if ('after' in at) idx = subtreeEnd(rest, at.after) + 1;
  else idx = parentId ? subtreeEnd(rest, parentId) + 1 : rest.length;
  rest.splice(idx < 0 ? rest.length : idx, 0, ...moved);
  return rest;
}
/** selected items that do not have a selected ancestor, in tree order */
function selectionTops(nodes: Node[], ids: string[]) {
  const sel = new Set(ids);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasSelAncestor = (n: Node) => {
    let p = n.parentId ? byId.get(n.parentId) : undefined;
    while (p) {
      if (sel.has(p.id)) return true;
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return false;
  };
  return nodes.filter((n) => sel.has(n.id) && !hasSelAncestor(n));
}

function stopCurrent(nodes: Node[], cur: Current | null, at: number): Node[] {
  if (!cur) return nodes;
  return nodes.map((n) =>
    n.id === cur.id ? { ...n, spent: (n.spent ?? 0) + (at - cur.since), status: n.status === 'doing' ? 'todo' : n.status } : n,
  );
}

export const planOf = (s: State) => reconcilePlan(s.plan, s.nodes, s.meetings);

/* ---------- generic item ops ---------- */
export function patchNodes(label: string, ids: string[], p: Partial<Node> | ((n: Node) => Partial<Node>)) {
  if (!ids.length) return;
  const t = new Set(ids);
  commit(label, (s) => ({
    nodes: s.nodes.map((n) => (t.has(n.id) ? { ...n, ...(typeof p === 'function' ? p(n) : p), modified: Date.now() } : n)),
  }));
}

export function addNode(parentId: string | null, title: string, afterId?: string | null, extra: Partial<Node> = {}, label = 'Add item', beforeId?: string): string {
  const node = mk(parentId, title, extra);
  commit(label, (s) => ({ nodes: openIt(beforeId ? insertBefore(s.nodes, node, beforeId) : insertAfter(s.nodes, node, afterId), parentId), sel: node.id, multi: [] }));
  return node.id;
}

export function removeNodes(ids: string[], label = 'Delete') {
  commit(label, (s) => {
    const kill = subtreeIds(s.nodes, ids);
    return { nodes: s.nodes.filter((n) => !kill.has(n.id)), current: s.current && kill.has(s.current.id) ? null : s.current, multi: [], anchor: null };
  });
}

export const editText = (id: string, text: string) => patchNodes('Edit', [id], { title: text });

export function toggleCheckbox(id: string, line: number) {
  const n = get().nodes.find((x) => x.id === id);
  if (!n) return;
  const lines = n.title.split('\n');
  lines[line] = lines[line].replace(/\[( |x|X)\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  patchNodes('Toggle checkbox', [id], { title: lines.join('\n') });
}

export function setStatus(ids: string[], status: Status, label: string) {
  if (!ids.length) return;
  const t = new Set(ids);
  commit(label, (s) => {
    let nodes = s.nodes;
    let current = s.current;
    if (current && t.has(current.id) && status !== 'doing') {
      nodes = stopCurrent(nodes, current, Date.now());
      current = null;
    }
    return { nodes: nodes.map((n) => (t.has(n.id) ? { ...n, status, modified: Date.now() } : n)), current };
  });
}
/** an item is done when it is marked done; finishing its sub-items never completes it (the user does) */
export const isDone = (nodes: Node[], id: string) => {
  const n = nodes.find((x) => x.id === id);
  return !!n && n.status === 'done';
};

/**
 * done / not done is only a visual marker — nothing disappears. It applies to exactly the items given:
 * completing a parent never touches its children (they keep whatever state they had).
 */
export function toggleDoneNodes(ids: string[]) {
  const nodes = get().nodes;
  const known = ids.filter((id) => nodes.some((n) => n.id === id && n.status !== 'dropped'));
  if (!known.length) return;
  const allDone = known.every((id) => isDone(nodes, id));
  const targets = allDone ? known : known.filter((id) => !isDone(nodes, id));
  setStatus(targets, allDone ? 'todo' : 'done', allDone ? 'Mark not done' : 'Mark done');
}

export function toggleToday(id: string) {
  const nodes = get().nodes;
  const n = nodes.find((x) => x.id === id);
  if (!n) return;
  if (!hasKids(nodes, id)) return patchNodes(n.today ? 'Remove from Next' : 'Add to Next', [id], { today: !n.today, later: n.today ? n.later : undefined });
  const open = leavesOf(nodes, id).filter((l) => l.status !== 'done');
  if (n.today && open.every((l) => l.today)) return unplan([id]); // all of it is in Next: the whole hierarchy goes, parent included
  addToNext([id]);
}
/**
 * Add to Next (never takes anything out): each item itself and everything open under it (so a parent shows ★ today
 * too), and nothing in those hierarchies stays deferred (/tomorrow put `later` on the parent and middle levels as well).
 */
export function addToNext(ids: string[]) {
  const nodes = get().nodes;
  const sub = subtreeIds(nodes, ids);
  const roots = new Set(ids);
  const into = new Set(nodes.filter((x) => sub.has(x.id) && (roots.has(x.id) || (x.status !== 'done' && x.status !== 'dropped'))).map((x) => x.id));
  const touch = nodes.filter((x) => sub.has(x.id) && ((into.has(x.id) && !x.today) || x.later != null)).map((x) => x.id);
  patchNodes('Add to Next', touch, (x) => (into.has(x.id) ? { today: true, later: undefined } : { later: undefined }));
}
/** take items (with everything beneath them) out of Next; they stay in the Organizer */
export const unplan = (ids: string[]) => {
  patchNodes('Remove from Next', [...subtreeIds(get().nodes, ids)], { today: false });
};

export const toggleOpen = (id: string, open: boolean) => set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, open } : n)) }));
export function toggleCardOpen(c: CardM, open: boolean) {
  if (c.kind === 'task' && c.task) toggleOpen(c.task.id, open);
  else if (c.kind === 'meeting') set((s) => ({ meetings: s.meetings.map((m) => (m.id === c.ownerId ? { ...m, open } : m)) }));
}

export const setEst = (ids: string[], v: number | undefined) => patchNodes(v ? `Estimate ${v} min` : 'Clear estimate', ids, { est: v });
/** keys 1–5: show priorities 1…p (the same one again, or 0, shows everything) */
export const setPrioFilter = (p: number) => set((s) => ({ prioFilter: p && s.prioFilter !== p ? p : null, prioPick: null }));
export const openPrioPick = (ids: string[] | undefined, x: number, y: number) => set(() => ({ prioPick: { ids, x, y }, menu: null }));
export const closePrioPick = () => set(() => ({ prioPick: null }));
export const openScopePick = (id: string, x: number, y: number) => set(() => ({ scopePick: { id, x, y }, prioPick: null, menu: null }));
export const closeScopePick = () => set(() => ({ scopePick: null }));
/** the tick box beside a sub-item: in Next → out (with everything under it); out → in (with everything open under it) */
export const toggleScope = (id: string) => (get().nodes.find((n) => n.id === id)?.today ? unplan([id]) : addToNext([id]));
/** Ctrl+1–5: set the quick priority (the same digit again on all of them clears it; 0 clears) */
export function setPrio(ids: string[], p: number) {
  const nodes = get().nodes.filter((n) => ids.includes(n.id));
  if (!nodes.length) return;
  const v = p && nodes.every((n) => n.prio === p) ? undefined : p || undefined;
  patchNodes(v ? `Priority ${v}` : 'Clear priority', ids, { prio: v });
}
export const cycleEst = (ids: string[], dir: 1 | -1) => patchNodes('Estimate', ids, (n) => ({ est: stepEst(n.est, dir) }));
export const setDue = (ids: string[], days: number | null) =>
  patchNodes(days == null ? 'Clear due date' : 'Set due date', ids, { due: days == null ? undefined : isoDay(days) });
/** due on a specific day (yyyy-mm-dd), from the date picker */
export const setDueOn = (ids: string[], iso: string) => patchNodes('Set due date', ids, { due: iso });
/** /tomorrow, /reschedule: the whole subtree leaves Next (the parent too, so it does not linger as a header);
 *  what was in Next — or, when nothing was, the open leaves — comes back on that day (rollDay) */
export function deferTo(ids: string[], days: number) {
  const nodes = get().nodes;
  const all = subtreeIds(nodes, ids);
  const open = (n: Node) => n.status !== 'done' && n.status !== 'dropped';
  const back = new Set<string>();
  for (const id of ids) {
    const ids = subtree(nodes, id);
    const sub = nodes.filter((n) => ids.has(n.id));
    const inNext = sub.filter((n) => n.today && open(n));
    (inNext.length ? inNext : leavesOf(nodes, id).filter(open)).forEach((n) => back.add(n.id));
  }
  patchNodes(days === 1 ? 'Move to tomorrow' : `Reschedule +${days}d`, [...all], (n) => (back.has(n.id) ? { today: false, later: days } : { today: false }));
  toast(days === 1 ? 'Moved to tomorrow' : `Rescheduled to ${days} days from now`, 'good');
}
export const abandon = (ids: string[]) => {
  setStatus([...subtreeIds(get().nodes, ids)], 'dropped', 'Abandon');
  toast('Abandoned — still visible, struck out', 'info');
};

export function duplicate(ids: string[]) {
  commit('Duplicate', (s) => {
    const tops = selectionTops(s.nodes, ids);
    if (!tops.length) return null;
    let nodes = s.nodes;
    let plan = planOf(s);
    let last: string | null = null;
    for (const src of tops) {
      const sub = subtree(nodes, src.id);
      const map = new Map<string, string>();
      const copies = nodes
        .filter((n) => sub.has(n.id))
        .map((n) => {
          const nid = uid();
          map.set(n.id, nid);
          return { ...n, id: nid, status: (n.smart ? 'waiting' : 'todo') as Status, spent: undefined, lastRun: undefined, created: Date.now(), modified: Date.now() };
        });
      copies.forEach((c) => {
        if (c.parentId && map.has(c.parentId)) c.parentId = map.get(c.parentId)!;
      });
      const at = subtreeEnd(nodes, src.id);
      nodes = [...nodes.slice(0, at + 1), ...copies, ...nodes.slice(at + 1)];
      const copyId = map.get(src.id)!;
      last = copyId;
      // keep the copy right after the original inside Next
      plan = planOf({ ...s, nodes, plan }).map((sg) => ({ ...sg, items: sg.items.filter((x) => x !== copyId) }));
      const si = segOf(plan, src.id);
      if (si >= 0) {
        const items = [...plan[si].items];
        items.splice(items.indexOf(src.id) + 1, 0, copyId);
        plan[si] = { ...plan[si], items };
      }
    }
    return { nodes, plan, sel: last, multi: [] };
  });
}

/* ---------- hierarchy: indent / outdent / move / reorder (any item, any depth) ---------- */
/**
 * ⌘]: each selected item becomes the last child of the sibling just above it
 * (skipping selected siblings, so a block indents together). `rowsOnly` restricts that sibling to items in Next.
 */
export function indentItems(ids: string[], rowsOnly = false) {
  const done = commit('Indent', (s) => {
    const sel = new Set(ids);
    let nodes = s.nodes;
    let moved = 0;
    const cards = rowsOnly ? nextModel(s).cards : [];
    for (const x of selectionTops(s.nodes, ids)) {
      let parent: Node | undefined;
      const card = cards.find((c) => c.rows.some((r) => r.id === x.id));
      if (card) {
        // in Next the neighbour is whatever is displayed right above (moving rows only reorders the plan, not the tree)
        const rows = card.rows;
        const ri = rows.findIndex((r) => r.id === x.id);
        for (let j = ri - 1; j >= 0 && rows[j].depth >= rows[ri].depth; j--) {
          if (rows[j].depth === rows[ri].depth && rows[j].node && !sel.has(rows[j].id)) {
            parent = rows[j].node;
            break;
          }
        }
        // a card's top row: the neighbour above is the top row of the item card above (never something inside itself)
        if (!parent && rows[ri].depth === 0 && card.kind === 'task') {
          for (let k = cards.indexOf(card) - 1; k >= 0 && cards[k].kind === 'task'; k--) {
            const above = cards[k].rows[0];
            if (above?.node && !sel.has(above.id) && !isUnder(nodes, above.id, x.id)) {
              parent = above.node;
              break;
            }
          }
        }
      } else {
        const sibs = nodes.filter((n) => n.parentId === x.parentId);
        let i = sibs.findIndex((n) => n.id === x.id) - 1;
        while (i >= 0 && (sel.has(sibs[i].id) || (rowsOnly && !sibs[i].today))) i--;
        parent = sibs[i];
      }
      if (!parent || isUnder(nodes, parent.id, x.id)) continue;
      nodes = openIt(relocate(nodes, x.id, parent.id, { end: true }), parent.id);
      moved++;
    }
    return moved ? { nodes } : null;
  });
  if (!done) toast('Nothing above to indent under');
}

/** ⌘[: each selected item becomes the next sibling of its parent */
export function outdentItems(ids: string[]) {
  const done = commit('Outdent', (s) => {
    let nodes = s.nodes;
    const placedAfter = new Map<string, string>();
    const after2: [string, string][] = [];
    let moved = 0;
    for (const x of selectionTops(s.nodes, ids)) {
      const cur = nodes.find((n) => n.id === x.id)!;
      const parent = nodes.find((n) => n.id === cur.parentId);
      if (!parent) continue; // already at the top level (or inside a calendar item)
      const after = placedAfter.get(parent.id) ?? parent.id;
      nodes = relocate(nodes, x.id, parent.parentId, { after });
      placedAfter.set(parent.id, x.id);
      moved++;
      if (cur.today) after2.push([x.id, after]);
    }
    if (!moved) return null;
    // in Next the item stays where it was on screen: right below its former parent (or the previous one moved out)
    let plan = planOf({ ...s, nodes });
    for (const [id, ref] of after2) {
      const ti = plan.findIndex((sg) => sg.items.includes(id));
      const ri = plan.findIndex((sg) => sg.items.includes(ref));
      if (ti < 0 || ri < 0) continue;
      plan = plan.map((sg, j) => (j === ti ? { ...sg, items: sg.items.filter((v) => v !== id) } : sg));
      plan = plan.map((sg, j) => (j === ri ? { ...sg, items: [...sg.items.slice(0, sg.items.indexOf(ref) + 1), id, ...sg.items.slice(sg.items.indexOf(ref) + 1)] } : sg));
    }
    return { nodes, plan };
  });
  if (!done) toast('Already at the top level');
}

/** move a block of siblings up/down one step (neighbours that are themselves selected are skipped over) */
export function reorderItems(ids: string[], dir: -1 | 1, rowsOnly = false) {
  return commit('Reorder', (s) => {
    const sel = new Set(ids);
    let nodes = s.nodes;
    let moved = 0;
    const tops = selectionTops(s.nodes, ids);
    for (const x of dir === 1 ? [...tops].reverse() : tops) {
      const sibs = nodes.filter((n) => n.parentId === x.parentId);
      let i = sibs.findIndex((n) => n.id === x.id) + dir;
      while (sibs[i] && rowsOnly && !sibs[i].today && !sel.has(sibs[i].id)) i += dir;
      const nb = sibs[i];
      if (!nb || sel.has(nb.id)) continue;
      nodes = relocate(nodes, x.id, x.parentId, dir === -1 ? { before: nb.id } : { after: nb.id });
      moved++;
    }
    return moved ? { nodes } : null;
  });
}
export const reorder = (id: string, dir: -1 | 1) => reorderItems([id], dir);

/** drag & drop in the organizer: any item can go under any other (never into itself) */
export function moveNode(id: string, parentId: string | null, beforeId: string | null) {
  commit('Move', (s) => {
    if (!s.nodes.some((n) => n.id === id) || id === beforeId) return null;
    if (parentId && subtree(s.nodes, id).has(parentId)) return null;
    return { nodes: openIt(relocate(s.nodes, id, parentId, beforeId ? { before: beforeId } : { end: true }), parentId), sel: id, multi: [] };
  });
}

/* ---------- Next: plan (cards / splits) ops ---------- */
const segOf = (plan: Seg[], itemId: string) => plan.findIndex((sg) => sg.items.includes(itemId));
const withItems = (plan: Seg[], i: number, items: string[]) => plan.map((sg, j) => (j === i ? { ...sg, items } : sg));
/** the Next row directly under a card header that this (possibly nested) row belongs to */
function rootRowOf(nodes: Node[], plan: Seg[], id: string): string {
  let cur: string = id;
  for (let i = 0; i < 50; i++) {
    if (segOf(plan, cur) >= 0) return cur;
    const p = nodes.find((n) => n.id === cur)?.parentId;
    if (!p) break;
    cur = p;
  }
  return id;
}

/** new row below `afterId` / above `beforeId` (as their sibling, at any depth) or, with neither, at the top of the card */
export function addAction(ownerId: string, segId: string | undefined, afterId: string | null, text: string, beforeId?: string): string {
  const all = get().nodes;
  const anchor = all.find((n) => n.id === (beforeId ?? afterId));
  const parentId = anchor ? anchor.parentId : ownerId === ROOT ? null : ownerId;
  const node = mk(parentId, text, { today: true });
  commit('Add item', (s) => {
    const sib = afterId && anchor ? anchor.id : (parentId && lastChild(s.nodes, parentId)) || parentId;
    const nodes = openIt(beforeId && anchor ? insertBefore(s.nodes, node, beforeId) : insertAfter(s.nodes, node, sib), parentId);
    const meetings = s.meetings.map((m) => (m.id === ownerId ? { ...m, open: true } : m));
    const base = planOf({ ...s, nodes, meetings });
    let plan = base.map((sg) => ({ ...sg, items: sg.items.filter((x) => x !== node.id) }));
    if (base.some((sg) => sg.items.includes(node.id))) {
      // a top-level row of the card: slot it in beside its neighbour (or first)
      const ref = beforeId ?? afterId;
      const ti = ref && segOf(plan, ref) >= 0 ? segOf(plan, ref) : plan.findIndex((sg) => sg.id === segId);
      if (ti >= 0) {
        const items = [...plan[ti].items];
        const at = ref && items.includes(ref) ? items.indexOf(ref) + (beforeId ? 0 : 1) : 0;
        items.splice(at, 0, node.id);
        plan = withItems(plan, ti, items);
      } else plan = base;
    } else plan = base; // nested under a row: the tree order is enough
    const card = plan.find((sg) => sg.items.includes(rootRowOf(nodes, plan, node.id)))?.id ?? null;
    return { nodes, meetings, plan, nsel: { card, row: node.id }, multi: [] };
  });
  return node.id;
}

export function addTaskCard(parentId: string | null, title: string, afterSeg: string | null): { id: string; seg: string } {
  const node = mk(parentId, title);
  commit('Add item', (s) => {
    const nodes = openIt(insertAfter(s.nodes, node, parentId ? lastChild(s.nodes, parentId) ?? parentId : null), parentId);
    const seg: Seg = { id: 's_' + node.id, owner: node.id, items: [], keep: true };
    const plan = planOf({ ...s, nodes });
    const at = afterSeg ? plan.findIndex((sg) => sg.id === afterSeg) : -1;
    plan.splice(afterSeg === null ? 0 : at < 0 ? plan.length : at + 1, 0, seg);
    return { nodes, plan, nsel: { card: seg.id, row: null }, multi: [] };
  });
  return { id: node.id, seg: 's_' + node.id };
}

/** ids of cards the user can order (not pinned by time / by an alert) */
const movableOrder = (s: State, plan: Seg[]) =>
  nextModel({ ...s, plan })
    .cards.filter((c) => c.seg && !c.pinned)
    .map((c) => c.seg!.id);

function moveSegPatch(s: State, plan: Seg[], segId: string, dir: -1 | 1): Partial<State> | null {
  const order = movableOrder(s, plan);
  const k = order.indexOf(segId);
  const t = order[k + dir];
  if (k < 0 || !t) return null;
  const seg = plan.find((sg) => sg.id === segId)!;
  const rest = plan.filter((sg) => sg.id !== segId);
  const at = rest.findIndex((sg) => sg.id === t);
  rest.splice(dir === 1 ? at + 1 : at, 0, seg);
  return { plan: rest };
}

export const moveCard = (key: string, dir: -1 | 1) => commit('Reorder', (s) => moveSegPatch(s, planOf(s), key, dir));

/** ⌘↑/↓ on a row: reorder inside its card; past the edge it splits out of the card (or moves the card if alone) */
export function moveRow(id: string, dir: -1 | 1) {
  if (!id.startsWith(FX) && segOf(planOf(get()), id) < 0) return reorderItems([id], dir, true); // nested row: tree order among its Next siblings
  commit('Reorder', (s) => {
    const plan = planOf(s);
    const si = segOf(plan, id);
    if (si < 0) return null;
    const sg = plan[si];
    const i = sg.items.indexOf(id);
    const j = i + dir;
    if (j >= 0 && j < sg.items.length) {
      const items = [...sg.items];
      [items[i], items[j]] = [items[j], items[i]];
      return { plan: withItems(plan, si, items) };
    }
    if (id.startsWith(FX)) return null; // the calendar row never leaves its meeting
    if (sg.items.length > 1) {
      const ns: Seg = { id: 's_' + uid(), owner: sg.owner, items: [id], pulled: sg.pulled };
      const out = withItems(plan, si, sg.items.filter((x) => x !== id));
      out.splice(dir === -1 ? si : si + 1, 0, ns);
      return { plan: out, nsel: { card: ns.id, row: id } };
    }
    return moveSegPatch(s, plan, sg.id, dir);
  });
}

/** ⌘↑/↓ on a multi-selection of rows: the block moves one step */
export function moveRows(ids: string[], dir: -1 | 1) {
  const plan = planOf(get());
  const tops = ids.filter((id) => segOf(plan, id) >= 0);
  if (tops.length === ids.length) {
    const si = segOf(plan, tops[0]);
    if (!tops.every((id) => segOf(plan, id) === si)) return toast('Select rows from one card to move them together');
    commit('Reorder', (s) => {
      const p = planOf(s);
      const items = [...p[si].items];
      const sel = new Set(tops);
      const order = dir === 1 ? [...items.keys()].reverse() : [...items.keys()];
      let moved = 0;
      for (const i of order) {
        const j = i + dir;
        if (sel.has(items[i]) && items[j] !== undefined && !sel.has(items[j])) {
          [items[i], items[j]] = [items[j], items[i]];
          moved++;
        }
      }
      return moved ? { plan: withItems(p, si, items) } : null;
    });
  } else reorderItems(ids, dir, true);
}

/** the segment owner an item belongs to: its parent (or the top level) */
const ownerOfNode = (n: Node) => n.parentId ?? ROOT;
/** is this item a sub-item of a Next row (it nests under it unless pulled out)? */
const nestsInNext = (nodes: Node[], n: Node) => !!n.parentId && !!nodes.find((p) => p.id === n.parentId)?.today;

/**
 * drop a row onto another row in Next: before / after it (as its sibling) or into it (as its last child).
 * Any item can go anywhere but into itself, the same as in the Organizer; it stays in Next where it lands.
 */
export function dropOnRow(id: string, targetId: string, pos: 'before' | 'after' | 'into', segKey: string | null) {
  commit('Move', (s) => {
    const n = s.nodes.find((x) => x.id === id);
    const t = s.nodes.find((x) => x.id === targetId);
    if (!n || !t || isUnder(s.nodes, targetId, id)) return null;
    const parentId = pos === 'into' ? t.id : t.parentId;
    let nodes = relocate(s.nodes, id, parentId, pos === 'into' ? { end: true } : pos === 'before' ? { before: t.id } : { after: t.id });
    nodes = openIt(nodes, parentId).map((x) => (x.id === id && !x.today ? { ...x, today: true, later: undefined } : x));
    let plan = planOf(s).map((sg) => ({ ...sg, items: sg.items.filter((x) => x !== id) }));
    // a row directly under its card's item (not nested under another Next row): put it where it was dropped
    const owner = parentId ?? ROOT;
    if (!(parentId && nodes.find((x) => x.id === parentId)?.today)) {
      const ti = pos === 'into' ? plan.findIndex((sg) => sg.id === segKey && sg.owner === owner) : plan.findIndex((sg) => sg.owner === owner && sg.items.includes(t.id));
      if (ti >= 0) {
        const items = [...plan[ti].items];
        items.splice(pos === 'into' ? items.length : items.indexOf(t.id) + (pos === 'after' ? 1 : 0), 0, id);
        plan = withItems(plan, ti, items);
      }
    }
    plan = reconcilePlan(plan, nodes, s.meetings);
    return { nodes, plan, nsel: { card: null, row: id }, multi: [] };
  });
}

/**
 * dropping a row outside its card splits the schedule: same item, a new segment elsewhere.
 * A sub-item takes its parent along as the new card's header (a repeat); the parent row stays where it was.
 */
export function dropRowSplit(id: string, targetSegId: string, pos: 'before' | 'after') {
  commit('Split task', (s) => {
    if (id.startsWith(FX)) return null;
    const n = s.nodes.find((x) => x.id === id);
    const plan = planOf(s);
    const si = segOf(plan, id);
    const ti = plan.findIndex((sg) => sg.id === targetSegId);
    if (!n || ti < 0 || (si >= 0 && si === ti && plan[si].items.length < 2)) return null;
    const ns: Seg = { id: 's_' + uid(), owner: si >= 0 ? plan[si].owner : ownerOfNode(n), items: [id] };
    if (nestsInNext(s.nodes, n)) ns.pulled = true;
    const out = plan.map((sg) => ({ ...sg, items: sg.items.filter((x) => x !== id) }));
    out.splice(pos === 'before' ? ti : ti + 1, 0, ns);
    return { plan: out, nsel: { card: ns.id, row: id } };
  });
}

export function dropCard(key: string, targetKey: string | null, pos: 'before' | 'after') {
  commit('Reorder', (s) => {
    if (key === targetKey) return null;
    const plan = planOf(s);
    const seg = plan.find((sg) => sg.id === key);
    if (!seg) return null;
    const rest = plan.filter((sg) => sg.id !== key);
    const at = targetKey ? rest.findIndex((sg) => sg.id === targetKey) : rest.length;
    if (at < 0) return null;
    rest.splice(targetKey ? (pos === 'before' ? at : at + 1) : rest.length, 0, seg);
    return { plan: rest };
  });
}

/**
 * bring every segment of the task into this one — and any sub-items pulled out of rows in this card back under their parents.
 * On a pulled card that is the only one of its kind, its sub-items go back under their parent row.
 */
export function consolidate(segId: string) {
  let msg = 'Consolidated all actions here';
  const done = commit('Consolidate', (s) => {
    const plan = planOf(s);
    const t = plan.find((sg) => sg.id === segId);
    if (!t) return null;
    const others = plan.filter((sg) => sg.owner === t.owner && sg.id !== segId);
    const here = subtreeIds(s.nodes, t.items.filter((x) => !x.startsWith(FX)));
    const pulledIn = plan.filter((sg) => sg.pulled && sg.id !== segId && here.has(sg.owner));
    if (!others.length && !pulledIn.length) {
      if (!t.pulled) return null;
      msg = 'Back under its parent';
      return { plan: plan.filter((sg) => sg !== t) };
    }
    const items = [...t.items, ...others.flatMap((o) => o.items)];
    return { plan: plan.filter((sg) => !others.includes(sg) && !pulledIn.includes(sg)).map((sg) => (sg.id === segId ? { ...sg, items } : sg)) };
  });
  toast(done ? msg : 'Already all in one place', done ? 'good' : 'info');
}

/* ---------- collapse / expand all (− / +) ---------- */
/** Next: every card, every row with sub-items (collapsing also folds open notes) */
export function openAllNext(open: boolean) {
  const s = get();
  const ids = new Set<string>();
  for (const c of nextModel({ ...s, nodes: s.nodes.map((n) => (n.open ? n : { ...n, open: true })) }).cards) {
    if (c.kind === 'task' && c.task) ids.add(c.task.id);
    for (const r of c.rows) if (r.node && r.kids) ids.add(r.node.id);
  }
  set((st) => ({
    nodes: st.nodes.map((n) => (ids.has(n.id) && n.open !== open ? { ...n, open } : n)),
    meetings: st.meetings.map((m) => ((m.open !== false) !== open ? { ...m, open } : m)),
    expanded: open ? st.expanded : {},
  }));
}
/** Organizer: every item with children */
export function openAllTree(open: boolean) {
  set((st) => ({ nodes: st.nodes.map((n) => (n.open !== open && st.nodes.some((c) => c.parentId === n.id) ? { ...n, open } : n)) }));
}

/* ---------- start / stopwatch / focus ---------- */
export function startAction(id: string) {
  const n = get().nodes.find((x) => x.id === id);
  if (!n) return;
  if (n.smart) return toast(`(mock) opening ${n.title.split('\n')[0]} in browser`);
  commit('Start', (s) => {
    const at = Date.now();
    let nodes = stopCurrent(s.nodes, s.current, at);
    nodes = nodes.map((x) => (x.id === id ? { ...x, status: 'doing', lastRun: at, today: true, later: undefined, modified: at } : x));
    // reveal it: a started item must be visible, so open any collapsed parents above it
    const anc = new Set<string>();
    for (let p = nodes.find((x) => x.id === id)?.parentId; p; p = nodes.find((x) => x.id === p)?.parentId ?? null) anc.add(p);
    nodes = nodes.map((x) => (anc.has(x.id) && !x.open ? { ...x, open: true } : x));
    // starting moves the row — and its card — to the top of the stack
    let plan = planOf({ ...s, nodes });
    const root = rootRowOf(nodes, plan, id);
    const si = segOf(plan, root);
    if (si >= 0) {
      const seg = { ...plan[si], items: [root, ...plan[si].items.filter((x) => x !== root)] };
      plan = [seg, ...plan.filter((_, j) => j !== si)];
    }
    return {
      nodes,
      plan,
      current: { id, since: at },
      nsel: { card: plan[0]?.id ?? null, row: id },
      multi: [],
      expanded: { ...s.expanded, [id]: true },
    };
  });
}
export function stopAction() {
  commit('Pause', (s) => (s.current ? { nodes: stopCurrent(s.nodes, s.current, Date.now()), current: null } : null));
}
export function toggleStart(id: string) {
  if (get().current?.id === id) stopAction();
  else startAction(id);
}
/** shift+space on any item: start it, or — if it has children — its first open leaf */
export function toggleStartItem(id: string) {
  const cur = get().current;
  if (cur && subtree(get().nodes, id).has(cur.id)) return stopAction(); // the running leaf is inside: pause it
  if (hasKids(get().nodes, id)) startFirst(id);
  else toggleStart(id);
}
export function focusItem(id: string) {
  if (hasKids(get().nodes, id)) {
    startFirst(id);
    const c = get().current;
    if (c) startFocus(c.id);
  } else startFocus(id);
}
/** enter on a task / project / card: start its first open action */
export function startFirst(nodeId: string) {
  const s = get();
  const sub = subtree(s.nodes, nodeId);
  const n = s.nodes.find((x) => sub.has(x.id) && startable(x, s.nodes));
  if (n) startAction(n.id);
  else toast('No open actions to start here');
}
export function startCard(c: CardM) {
  if (c.kind === 'attention') return toast(`(mock) opening ${c.rows[0].node!.title.split('\n')[0]} in browser`);
  const r = c.rows.find((x) => x.node && startable(x.node, get().nodes));
  if (r) return startAction(r.id);
  if (c.kind === 'meeting') return toast(`(mock) joining ${c.meeting!.title}`);
  toast('No open actions to start here');
}

export function startFocus(nodeId: string, durationMin?: number) {
  startAction(nodeId);
  const n = get().nodes.find((x) => x.id === nodeId);
  if (!n || get().current?.id !== nodeId) return;
  const f: FocusState = { nodeId, durationMin: durationMin ?? n.est ?? 25, startedAt: Date.now(), pausedTotal: 0, extra: 0, ended: false };
  set((s) => ({ focus: f, prevLayout: s.layout === 'pill' ? s.prevLayout : s.layout, hidden: false, menu: null }));
}

export function focusElapsedMin(f: FocusState, nowMs = Date.now()): number {
  const end = f.ended && f.elapsedAtEnd != null ? null : f.pausedAt ?? nowMs;
  if (end == null) return f.elapsedAtEnd!;
  return ((end - f.startedAt - f.pausedTotal) * get().focusSpeed) / 60000;
}
export function endFocus() {
  const f = get().focus;
  if (!f || f.ended) return;
  set(() => ({ focus: { ...f, ended: true, elapsedAtEnd: Math.min(focusElapsedMin(f), f.durationMin + f.extra) } }));
}
export function pauseFocus() {
  const f = get().focus;
  if (!f || f.ended) return;
  if (f.pausedAt) set(() => ({ focus: { ...f, pausedAt: undefined, pausedTotal: f.pausedTotal + (Date.now() - f.pausedAt!) } }));
  else set(() => ({ focus: { ...f, pausedAt: Date.now() } }));
}
export const extendFocus = (m: number) =>
  set((s) => (s.focus ? { focus: { ...s.focus, extra: s.focus.extra + m, ended: false, elapsedAtEnd: undefined } } : {}));

export function leaveFocus(opts: { done?: boolean; next?: string } = {}) {
  const f = get().focus;
  if (!f) return;
  const elapsed = f.elapsedAtEnd ?? focusElapsedMin(f);
  if (opts.done) setStatus([f.nodeId], 'done', 'Mark done');
  else stopAction();
  // a simulated clock (developer panel) jumps ahead by the session; the real one has moved on by itself
  set((s) => ({ focus: null, layout: backFromPill(s), tab: 'next', ...(s.clockManual || s.clockSpeed ? { clock: s.clock + elapsed } : {}) }));
  if (opts.next) startFocus(opts.next);
}

/* ---------- meetings ---------- */
export function rescheduleMeeting(id: string, deltaMin: number) {
  commit('Reschedule meeting', (s) => {
    const eff = meetingsFor(s).find((m) => m.id === id);
    if (!eff) return null;
    return { meetings: s.meetings.map((m) => (m.id === id ? { ...m, start: eff.eff + deltaMin, movedTo: undefined } : m)) };
  });
  const m = meetingsFor(get()).find((x) => x.id === id);
  if (m) toast(`${m.title} moved to ${fmt(m.eff)} (mock — would update Outlook)`, 'warn');
}

/* ---------- inbox ---------- */
export function capture(text: string) {
  text = text.trim();
  if (!text) return;
  commit('Capture', (s) => ({ inbox: [{ id: uid(), text, created: Date.now() }, ...s.inbox] }));
}
/** add an inbox item right below `afterId` (null = at the top) or right above `beforeId` */
export function captureAt(text: string, afterId: string | null, beforeId?: string): string {
  const it = { id: uid(), text: text.trim(), created: Date.now() };
  commit('Capture', (s) => {
    const inbox = [...s.inbox];
    const bi = beforeId ? inbox.findIndex((x) => x.id === beforeId) : -1;
    const ai = afterId ? inbox.findIndex((x) => x.id === afterId) : -1;
    inbox.splice(bi >= 0 ? bi : ai >= 0 ? ai + 1 : 0, 0, it);
    return { inbox, isel: it.id };
  });
  return it.id;
}
export function dropInboxMany(ids: string[]) {
  commit(ids.length > 1 ? `Discard ${ids.length} inbox items` : 'Discard inbox item', (s) => ({ inbox: s.inbox.filter((i) => !ids.includes(i.id)) }));
}
export function reorderInboxMany(ids: string[], dir: -1 | 1) {
  commit('Reorder inbox', (s) => {
    const inbox = [...s.inbox];
    const order = dir < 0 ? inbox.map((_, i) => i) : inbox.map((_, i) => inbox.length - 1 - i);
    let moved = false;
    for (const i of order) {
      const j = i + dir;
      if (!ids.includes(inbox[i].id) || j < 0 || j >= inbox.length || ids.includes(inbox[j].id)) continue;
      [inbox[i], inbox[j]] = [inbox[j], inbox[i]];
      moved = true;
    }
    return moved ? { inbox } : null;
  });
}
/** file inbox items as new items under `parentId` (before `beforeId`, else at the end) — what dropping on the organizer does */
export function fileInboxTo(ids: string[], parentId: string | null, beforeId: string | null) {
  const items = get().inbox.filter((i) => ids.includes(i.id));
  if (!items.length) return;
  let first = '';
  commit(items.length > 1 ? `File ${items.length} items` : `File "${items[0].text.slice(0, 24)}"`, (s) => {
    let nodes = s.nodes;
    let last: string | null = null;
    for (const it of items) {
      const node = mk(parentId, it.text);
      first = first || node.id;
      if (beforeId) nodes = insertBefore(nodes, node, beforeId);
      else nodes = insertAfter(nodes, node, last ?? (parentId ? lastChild(nodes, parentId) ?? parentId : [...nodes].reverse().find((n) => !n.parentId)?.id ?? null));
      last = node.id;
    }
    nodes = openIt(nodes, parentId);
    const idx = s.inbox.findIndex((i) => ids.includes(i.id));
    const rest = s.inbox.filter((i) => !ids.includes(i.id));
    return { nodes, inbox: rest, sel: first, multi: [], isel: rest[Math.min(idx, rest.length - 1)]?.id ?? null };
  });
  toast(items.length > 1 ? `Filed ${items.length} items` : 'Filed', 'good');
}
export function dropInbox(id: string) {
  commit('Discard inbox item', (s) => ({ inbox: s.inbox.filter((i) => i.id !== id) }));
}
export function editInbox(id: string, text: string) {
  commit('Edit inbox item', (s) => ({ inbox: s.inbox.map((i) => (i.id === id ? { ...i, text } : i)) }));
}
export function reorderInbox(id: string, dir: -1 | 1) {
  commit('Reorder', (s) => {
    const i = s.inbox.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.inbox.length) return null;
    const inbox = [...s.inbox];
    [inbox[i], inbox[j]] = [inbox[j], inbox[i]];
    return { inbox };
  });
}

/** file an inbox item: it becomes a new child item of whatever you drop it on */
export function fileInbox(itemId: string, targetId: string) {
  const item = get().inbox.find((i) => i.id === itemId);
  const target = get().nodes.find((n) => n.id === targetId);
  if (!item || !target) return;
  const node = mk(target.id, item.text);
  commit(`File "${item.text.slice(0, 24)}"`, (s) => {
    const nodes = openIt(insertAfter(s.nodes, node, lastChild(s.nodes, target.id) ?? target.id), target.id);
    const idx = s.inbox.findIndex((i) => i.id === itemId);
    const next = s.inbox[idx + 1] ?? s.inbox[idx - 1];
    return { nodes, inbox: s.inbox.filter((i) => i.id !== itemId), sel: target.id, isel: next?.id ?? null };
  });
  toast(`Filed under ${target.title.split('\n')[0]}`, 'good');
}

export async function suggestInbox(ids?: string[]) {
  const s = get();
  const targets = ids ?? s.inbox.filter((i) => !i.suggestion).map((i) => i.id);
  set((st) => ({ aiBusy: 'Organizing inbox…', inbox: st.inbox.map((i) => (targets.includes(i.id) ? { ...i, suggesting: true } : i)) }));
  await sleep(get().aiDelay);
  set((st) => ({
    aiBusy: null,
    inbox: st.inbox.map((i) => (targets.includes(i.id) ? { ...i, suggesting: false, suggestion: aiSuggest(i.text, st.nodes) } : i)),
  }));
}
export const clearSuggestion = (id: string) => set((s) => ({ inbox: s.inbox.map((i) => (i.id === id ? { ...i, suggestion: null } : i)) }));

/* ---------- AI (mocked) ---------- */
export async function breakDown(taskId: string) {
  const t = get().nodes.find((n) => n.id === taskId);
  if (!t) return;
  set(() => ({ aiBusy: `Breaking down "${t.title.split('\n')[0]}"…` }));
  await sleep(get().aiDelay);
  const steps = aiBreakdown(plain(t.title.split('\n')[0]));
  const made: string[] = [];
  commit('AI breakdown', (s) => {
    const inNext = t.today || leavesOf(s.nodes, taskId).some((l) => l.today);
    let nodes = s.nodes;
    let after = lastChild(nodes, taskId) ?? taskId;
    for (const st of steps) {
      const node = mk(taskId, st.title, { est: st.est, today: inNext });
      made.push(node.id);
      nodes = insertAfter(nodes, node, after);
      after = node.id;
    }
    return { nodes: openIt(nodes, taskId), sel: taskId };
  });
  set(() => ({ aiBusy: null }));
  highlight(made);
  toast(`Added ${steps.length} items to "${t.title.split('\n')[0]}"`, 'good');
}

export async function estimate(id: string) {
  set(() => ({ aiBusy: 'Estimating effort…' }));
  await sleep(get().aiDelay);
  const ids = leavesOf(get().nodes, id).filter((l) => !l.est).map((l) => l.id);
  patchNodes('AI estimate', ids, (n) => ({ est: aiEstimate(n.title) }));
  set(() => ({ aiBusy: null }));
  toast(ids.length ? `Estimated ${ids.length} item(s) from similar past work` : 'Nothing to estimate', ids.length ? 'good' : 'info');
}

export async function planToday() {
  set(() => ({ aiBusy: 'Planning your day…' }));
  await sleep(get().aiDelay + 400);
  const ids = aiPlan(get());
  commit('AI plan today', (s) => {
    if (!ids.length) return null;
    return { nodes: s.nodes.map((n) => (ids.includes(n.id) ? { ...n, today: true } : n)) };
  });
  set(() => ({ aiBusy: null }));
  highlight(ids);
  toast(ids.length ? `Added ${ids.length} actions to Next (fits around your meetings)` : 'Next already looks full', 'good');
}

/* ---------- AI popup (⌘/) ---------- */
/** the conversation is kept while its proposal is pending, so closing the popup does not lose it */
let parked: State['ai'] = null;
export function openAi(ctxId?: string) {
  const s = get();
  const node = ctxId ? s.nodes.find((n) => n.id === ctxId) : undefined;
  const meeting = ctxId ? s.meetings.find((m) => m.id === ctxId) : undefined;
  const ctx = node ? plain(node.title.split('\n')[0]) : meeting?.title;
  const keep = s.proposal && parked;
  if (!keep) resetConvo();
  set(() => ({ ai: keep ? { ...parked!, ctx, ctxId, busy: false, status: undefined } : { ctx, ctxId, msgs: [], busy: false }, menu: null }));
  parked = null;
}
export function closeAi() {
  const s = get();
  if (s.ai?.busy) stopTurn();
  parked = s.proposal ? s.ai : null;
  set(() => ({ ai: null }));
  focusArea();
}
const note = (text: string) => {
  const m = { id: uid(), role: 'note' as const, text };
  if (get().ai) set((s) => ({ ai: s.ai && { ...s.ai, msgs: [...s.ai.msgs, m] } }));
  else if (parked) parked = { ...parked, msgs: [...parked.msgs, m] };
};
export async function askAi(text: string) {
  text = text.trim();
  const a0 = get().ai;
  if (!text || !a0 || a0.busy) return;
  set((s) => ({ ai: s.ai && { ...s.ai, msgs: [...s.ai.msgs, { id: uid(), role: 'user', text }] } }));
  if (AI_CFG.configured) return chatTurn(text);
  // no API key: the old mocked replies
  set((s) => ({ ai: s.ai && { ...s.ai, busy: true } }));
  await sleep(get().aiDelay + 500);
  const s = get();
  if (!s.ai) return;
  const r = aiReply(text, s.ai.ctx, s);
  const chips: Chip[] = [];
  if (r.intent === 'plan') chips.push({ label: '✨ Plan my day', run: 'plan' });
  if (r.intent === 'breakdown' && s.ai.ctxId && s.nodes.some((n) => n.id === s.ai!.ctxId)) chips.push({ label: '✨ Add as actions', run: 'breakdown', id: s.ai.ctxId });
  const text2 = `${r.text}\n\n_(mocked — add an OpenAI API key in Settings, ⌘, — for the real assistant)_`;
  set((st) => ({ ai: st.ai && { ...st.ai, busy: false, msgs: [...st.ai.msgs, { id: uid(), role: 'ai', text: text2, chips: chips.length ? chips : undefined }] } }));
}

/** a chip under an AI reply was clicked */
export const runChip = (c: Chip) => (c.run === 'plan' ? planToday() : breakDown(c.id));

/** ⌘⏎ / ⌘⌫ — the AI's proposal becomes one undo step, or goes away */
export function acceptAi() {
  if (!get().proposal) return;
  const sum = acceptProposal();
  if (!sum) return;
  toast(`AI changes applied: ${sum} (⌘Z undoes)`, 'good');
  noteToModel('The user ACCEPTED your proposal; it is applied now.');
  note('✓ Accepted');
  if (!get().ai) parked = null;
}
export function rejectAi() {
  if (!get().proposal) return;
  rejectProposal();
  toast('AI proposal rejected — nothing changed', 'info');
  noteToModel('The user REJECTED your proposal; nothing was changed.');
  note('✕ Rejected');
  if (!get().ai) parked = null;
}
onBlocked(() => toast('Accept (⌘⏎) or reject (⌘⌫) the AI proposal first', 'warn'));

/* ---------- mock desktop controls ---------- */
export function setFlag(k: keyof Flags, v: boolean) {
  set((s) => ({ flags: { ...s.flags, [k]: v } }));
  void refreshNow(); // the mock plugins read the flags; the tracker turns what changed into highlights and toasts
}

/** developer panel: move the clock by hand (stops following real time until reset) */
export function setClockManual(next: number) {
  set(() => ({ clockManual: true }));
  setClock(next);
}
/** back to the real time of day */
export function followRealClock() {
  set(() => ({ clockManual: false, clockSpeed: 0 }));
  tickClock();
}
/** every few seconds: the clock follows real time (unless the developer panel took over), and a new day rolls over */
export function tickClock() {
  const s = get();
  if (s.day !== today()) rollDay();
  if (!s.clockManual && !s.clockSpeed) setClock(minutesNow());
}

/**
 * A new day: yesterday's meetings leave Next (their prep items stay, at the top level), items moved to "tomorrow" /
 * "in N days" come back into Next once their day is here — highlighted, since the user did not just put them there.
 * The undo history is cleared: it would bring yesterday back.
 */
export function rollDay() {
  const s = get();
  const now = today();
  if (s.day === now) return;
  const days = Math.max(1, Math.round((Date.parse(now) - Date.parse(s.day)) / 86_400_000) || 1);
  const gone = new Set(s.meetings.filter((m) => (m.day ?? s.day) < now).map((m) => m.id));
  const back: string[] = [];
  const nodes = s.nodes.map((n) => {
    let x = n;
    if (n.parentId && gone.has(n.parentId)) x = { ...x, parentId: null };
    if (n.later != null) {
      const left = n.later - days;
      if (left <= 0) {
        x = { ...x, later: undefined, today: true };
        back.push(n.id);
      } else x = { ...x, later: left };
    }
    return x;
  });
  set(() => ({
    day: now,
    nodes,
    meetings: s.meetings.filter((m) => !gone.has(m.id)),
    plan: s.plan.filter((g) => !gone.has(g.owner)),
    flags: { ...s.flags, meetingMoved: false },
    agenda: {},
    past: [],
    future: [],
  }));
  highlight(back);
  if (back.length) toast(`${back.length} item${back.length > 1 ? 's are' : ' is'} back in Next for today`, 'info');
}

/* ---------- app: settings, developer panel, data ---------- */
export const openSettings = () => set(() => ({ settingsOpen: true, hidden: false, menu: null }));
export const closeSettings = () => {
  set(() => ({ settingsOpen: false }));
  focusArea();
};
/** a plain UI-state change, for the views that edit settings directly (also callable from a popup window) */
/* ---------- edit as markdown (⌘E, see mdedit.ts) ---------- */
/** open the editor on the items picked together (several selected: those with their sub-items), or, with one or none selected or `all`, on everything the view shows (Next: its rows; Organizer: the tree) */
export function openMdEdit(all = false) {
  const s = get();
  if (s.tab === 'inbox') return;
  const picked = s.multi.filter((id) => s.nodes.some((n) => n.id === id));
  const selection = !all && picked.length > 1;
  const ids = scopeFor(s.nodes, selection ? 'selection' : s.tab === 'next' ? 'next' : 'tree', picked);
  set(() => ({ mdEdit: { ids, today: s.tab === 'next' }, hidden: false, menu: null }));
}
export const closeMdEdit = () => {
  set(() => ({ mdEdit: null }));
  focusArea();
};
/** replace the text of these items by `text`: only what differs is touched, as one undo step */
export function applyMarkdown(scope: string[], text: string, today = false) {
  const s = get();
  const plan = planEdit(s.nodes, scope, text, (id) => isDone(s.nodes, id), today);
  if (plan.same) {
    toast('No changes');
    return closeMdEdit();
  }
  commit('Edit as markdown', (st) => {
    let nodes = plan.nodes;
    let current = st.current;
    if (current && plan.removedIds.includes(current.id)) current = null;
    else if (current && plan.restated.includes(current.id)) (nodes = stopCurrent(nodes, current, Date.now()), (current = null));
    return { nodes, current, mdEdit: null, multi: [], anchor: null };
  });
  const { added, removed, changed, moved } = plan.stats;
  toast(['Applied', [added && `${added} added`, changed && `${changed} changed`, moved && `${moved} moved`, removed && `${removed} removed`].filter(Boolean).join(', ')].filter(Boolean).join(': '), 'good');
  focusArea();
}
export const patchUi = (p: Partial<State>) => set(() => p);
export const refreshAi = () => refreshAiKey();
/** Settings → Accounts: keep the token in the keychain, check it, start tracking */
export async function connectPlugin(id: string, token: string) {
  try {
    const as = await connectAccount(id, token);
    toast(`${pluginById(id)?.name ?? id}: connected as ${as}`, 'good');
    void refreshNow(id);
  } catch (e) {
    toast(`${pluginById(id)?.name ?? id}: ${e instanceof Error ? e.message : String(e)}`, 'bad');
  }
}
export async function disconnectPlugin(id: string) {
  try {
    await disconnectAccount(id);
    toast(`${pluginById(id)?.name ?? id}: token removed from the keychain`, 'info');
  } catch (e) {
    toast(`Keychain: ${String(e)}`, 'bad');
  }
}
/** Settings → Microsoft: sign in (the browser opens) for the sources set to use the Microsoft app registration; `sources` is what Settings has now */
export async function microsoftSignIn(client: string, tenant: string, sources: Source[]): Promise<boolean> {
  try {
    await grant(client, tenant, sources);
    toast('Signed in to Microsoft', 'good');
  } catch (e) {
    toast(`Microsoft: ${e instanceof Error ? e.message : String(e)}`, 'bad');
    return false;
  }
  sourcesChanged();
  return true;
}
/** Settings → Sources was saved (a source switched on or off, another way to sign in): look at the accounts again and fetch */
export function sourcesChanged() {
  void refreshAccounts().then(() => void refreshNow());
}
export async function microsoftSignOut() {
  try {
    await signOut();
    toast('Signed out of Microsoft: the sign-in is removed from the keychain', 'info');
  } catch (e) {
    toast(`Keychain: ${String(e)}`, 'bad');
  }
  await refreshAccounts();
  for (const p of ['outlook', 'devops']) void refreshNow(p);
  refreshMail();
}
/** Emails: forget how every mail was sorted and sort them again (another model) */
export function resortMail() {
  set((s) => ({ mail: resort(s.mail) }));
  toast('Emails: sorting them all again', 'info');
  void refreshNow('mail');
}
/** Emails: read Outlook again now (the window of days changed) */
export const refreshMail = () => void refreshNow('mail');
export const toggleDev = () => set((s) => ({ dev: !s.dev, hidden: false }));
export const setDemo = (demo: boolean) => set(() => ({ demo }));
export function loadDemo() {
  resetDoc(demoDoc(), true);
  toast('Demo data loaded — mocked connectors are on', 'good');
}
export function startEmpty() {
  resetDoc(emptyDoc(), get().demo);
  toast('Started with an empty document', 'info');
}

export function setClock(next: number) {
  const before = meetingsFor(get());
  set(() => ({ clock: next }));
  const after = meetingsFor(get());
  for (const m of after) {
    const prev = before.find((b) => b.id === m.id)!;
    if (prev.minsAway > 10 && m.minsAway <= 10 && m.minsAway > 0) toast(`${m.title} starts in ${Math.ceil(m.minsAway)} min (${fmt(m.eff)})`, 'warn');
  }
}

export function jumpToNextMeeting(beforeMin = 10) {
  const s = get();
  const next = meetingsFor(s).find((m) => m.state === 'upcoming');
  if (next) setClock(Math.max(s.clock, next.eff - beforeMin));
}

export function addInboxSamples() {
  commit('Add inbox samples', (s) => ({ inbox: [...seedInbox().slice(0, 3), ...s.inbox] }));
}


/* ---------- paste (markdown list → items) ---------- */
export function pasteItems(tree: ClipItem[], at: { parentId: string | null; afterId: string | null; next?: { owner: string; seg?: string } }) {
  if (!tree.length) return;
  const today = !!at.next;
  const made: Node[] = [];
  const tops: Node[] = [];
  const build = (items: ClipItem[], parentId: string | null, top: boolean) =>
    items.forEach((it) => {
      const n = mk(parentId, it.title, { today, status: it.done ? 'done' : it.dropped ? 'dropped' : 'todo', ...(it.est ? { est: it.est } : {}), ...(it.due ? { due: it.due } : {}), ...(it.prio ? { prio: it.prio } : {}) });
      made.push(n);
      if (top) tops.push(n);
      build(it.kids, n.id, false);
    });
  build(tree, at.parentId, true);
  commit(`Paste ${made.length} item${made.length > 1 ? 's' : ''}`, (s) => {
    let nodes = s.nodes;
    let after: string | null = at.afterId ?? (at.parentId ? lastChild(nodes, at.parentId) ?? at.parentId : null);
    for (const n of made) {
      nodes = insertAfter(nodes, n, after);
      after = n.id;
    }
    nodes = openIt(nodes, at.parentId);
    const out: Partial<typeof s> = { nodes, multi: tops.length > 1 ? tops.map((n) => n.id) : [], anchor: tops.length > 1 ? tops[0].id : null, sel: tops[0].id };
    if (at.next) {
      const meetings = s.meetings.map((m) => (m.id === at.next!.owner ? { ...m, open: true } : m));
      const base = planOf({ ...s, nodes, meetings });
      const slot = tops.filter((n) => base.some((sg) => sg.items.includes(n.id))).map((n) => n.id);
      let plan = base.map((sg) => ({ ...sg, items: sg.items.filter((x) => !slot.includes(x)) }));
      const ref = at.afterId;
      const ti = ref && segOf(plan, ref) >= 0 ? segOf(plan, ref) : plan.findIndex((sg) => sg.id === at.next!.seg);
      if (slot.length && ti >= 0) {
        const items = [...plan[ti].items];
        items.splice(ref && items.includes(ref) ? items.indexOf(ref) + 1 : 0, 0, ...slot);
        plan = withItems(plan, ti, items);
      } else plan = base;
      const card = plan.find((sg) => sg.items.includes(rootRowOf(nodes, plan, tops[0].id)))?.id ?? null;
      Object.assign(out, { meetings, plan, nsel: { card, row: tops[0].id } });
    }
    return out;
  });
  toast(`Pasted ${countItems(tree)} item${countItems(tree) > 1 ? 's' : ''}`, 'good');
}
export function captureMany(texts: string[], afterId: string | null) {
  if (!texts.length) return;
  const its = texts.map((text) => ({ id: uid(), text: text.trim(), created: Date.now() }));
  commit(`Paste ${its.length} item${its.length > 1 ? 's' : ''}`, (s) => {
    const inbox = [...s.inbox];
    const ai = afterId ? inbox.findIndex((x) => x.id === afterId) : -1;
    inbox.splice(ai + 1, 0, ...its);
    return { inbox, isel: its[0].id };
  });
  toast(`Pasted ${its.length} item${its.length > 1 ? 's' : ''}`, 'good');
}
