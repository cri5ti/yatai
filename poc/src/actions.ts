import { commit, docOf, get, seedInbox, set, uid } from './store';
import type { Current, Flags, FocusState, Kind, Layout, Node, Seg, State, Status, Tab, Toast } from './store';
import { aiBreakdown, aiEstimate, aiPlan, aiReply, aiSuggest, sleep } from './mock';
import { FX, fmt, isoDay, meetingsFor, nextModel, reconcilePlan, startable } from './model';
import type { CardM } from './model';
import { focusArea, stepEst } from './kbd';

/* ---------- toasts ---------- */
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = uid();
  set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => dismissToast(id), 5000);
}
export const dismissToast = (id: string) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/* ---------- navigation / window ---------- */
export const setTab = (tab: Tab) => set(() => ({ tab, hidden: false, menu: null, edit: null, ins: null }));
export const setLayout = (layout: Layout) => set(() => ({ layout, hidden: false }));
export const toggleHidden = () => set((s) => ({ hidden: !s.hidden }));
export const openCapture = () => set(() => ({ capture: true }));
export const closeCapture = () => set(() => ({ capture: false }));
export const closeMenu = () => {
  set(() => ({ menu: null }));
  focusArea();
};
export const toggleHelp = () => set((s) => ({ help: !s.help }));
export const pick = (card: string | null, row: string | null) => set(() => ({ nsel: { card, row } }));
export const setExpanded = (id: string, v: boolean) => set((s) => ({ expanded: { ...s.expanded, [id]: v } }));

/* ---------- undo / redo ---------- */
export function undo() {
  const e = get().past.at(-1);
  if (!e) return toast('Nothing to undo');
  set((s) => ({ ...e.doc, past: s.past.slice(0, -1), future: [{ label: e.label, doc: docOf(s) }, ...s.future] }));
  toast(`Undid: ${e.label}`);
}
export function redo() {
  const e = get().future[0];
  if (!e) return toast('Nothing to redo');
  set((s) => ({ ...e.doc, future: s.future.slice(1), past: [...s.past, { label: e.label, doc: docOf(s) }] }));
  toast(`Redid: ${e.label}`);
}

/* ---------- node helpers (pure) ---------- */
const mk = (kind: Kind, parentId: string | null, title: string, extra: Partial<Node> = {}): Node => ({
  id: uid(),
  parentId,
  kind,
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
/** insert after `afterId` and its whole subtree (keeps sibling order intact) */
function insertAfter(nodes: Node[], node: Node, afterId?: string | null): Node[] {
  const out = [...nodes];
  let idx = -1;
  if (afterId) {
    const sub = subtree(nodes, afterId);
    nodes.forEach((n, i) => {
      if (sub.has(n.id)) idx = i;
    });
  }
  if (idx < 0) out.push(node);
  else out.splice(idx + 1, 0, node);
  return out;
}
const lastChild = (nodes: Node[], pid: string) => [...nodes].reverse().find((n) => n.parentId === pid)?.id ?? null;
const openIt = (nodes: Node[], id: string | null) => nodes.map((n) => (n.id === id && !n.open ? { ...n, open: true } : n));

function stopCurrent(nodes: Node[], cur: Current | null, at: number): Node[] {
  if (!cur) return nodes;
  return nodes.map((n) =>
    n.id === cur.id ? { ...n, spent: (n.spent ?? 0) + (at - cur.since), status: n.status === 'doing' ? 'todo' : n.status } : n,
  );
}

export const planOf = (s: State) => reconcilePlan(s.plan, s.nodes, s.meetings);

/* ---------- generic node ops ---------- */
export function patchNodes(label: string, ids: string[], p: Partial<Node> | ((n: Node) => Partial<Node>)) {
  if (!ids.length) return;
  const t = new Set(ids);
  commit(label, (s) => ({
    nodes: s.nodes.map((n) => (t.has(n.id) ? { ...n, ...(typeof p === 'function' ? p(n) : p), modified: Date.now() } : n)),
  }));
}

export function addNode(kind: Kind, parentId: string | null, title: string, afterId?: string | null, extra: Partial<Node> = {}, label?: string): string {
  const node = mk(kind, parentId, title, extra);
  commit(label ?? `Add ${kind}`, (s) => ({ nodes: openIt(insertAfter(s.nodes, node, afterId), parentId), sel: node.id }));
  return node.id;
}

export function removeNodes(ids: string[], label = 'Delete') {
  commit(label, (s) => {
    const kill = new Set<string>();
    ids.forEach((id) => subtree(s.nodes, id).forEach((x) => kill.add(x)));
    return { nodes: s.nodes.filter((n) => !kill.has(n.id)), current: s.current && kill.has(s.current.id) ? null : s.current };
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
/** done / not done is only a visual marker: nothing disappears */
export function toggleDoneNodes(ids: string[]) {
  const ns = get().nodes.filter((n) => ids.includes(n.id));
  if (!ns.length) return;
  const allDone = ns.every((n) => n.status === 'done');
  setStatus(ids, allDone ? 'todo' : 'done', allDone ? 'Mark not done' : 'Mark done');
}
/** ids a "done"/"estimate"… command applies to for a container: the node and its actions (never projects) */
export const leafIds = (nodes: Node[], id: string) => {
  const sub = subtree(nodes, id);
  return nodes.filter((n) => sub.has(n.id) && n.kind !== 'project').map((n) => n.id);
};
export const actionIdsUnder = (nodes: Node[], id: string) => {
  const sub = subtree(nodes, id);
  return nodes.filter((n) => sub.has(n.id) && n.kind === 'action').map((n) => n.id);
};

export function toggleToday(id: string) {
  const n = get().nodes.find((x) => x.id === id);
  if (!n || n.kind === 'project') return;
  const on = !n.today;
  const ids = n.kind === 'task' ? [id, ...actionIdsUnder(get().nodes, id).filter((a) => get().nodes.find((x) => x.id === a)!.status !== 'done')] : [id];
  patchNodes(on ? 'Add to Next' : 'Remove from Next', ids, { today: on, later: undefined });
}
export const unplan = (ids: string[]) => patchNodes('Remove from Next', ids, { today: false });

export const toggleOpen = (id: string, open: boolean) => set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, open } : n)) }));
export function toggleCardOpen(c: CardM, open: boolean) {
  if (c.kind === 'task' && c.task) toggleOpen(c.task.id, open);
  else if (c.kind === 'meeting') set((s) => ({ meetings: s.meetings.map((m) => (m.id === c.ownerId ? { ...m, open } : m)) }));
}

export const setEst = (ids: string[], v: number | undefined) => patchNodes(v ? `Estimate ${v} min` : 'Clear estimate', ids, { est: v });
export const cycleEst = (ids: string[], dir: 1 | -1) => patchNodes('Estimate', ids, (n) => ({ est: stepEst(n.est, dir) }));
export const setDue = (ids: string[], days: number | null) =>
  patchNodes(days == null ? 'Clear due date' : 'Set due date', ids, { due: days == null ? undefined : isoDay(days) });
export function deferTo(ids: string[], days: number) {
  patchNodes(days === 1 ? 'Move to tomorrow' : `Reschedule +${days}d`, ids, { today: false, later: days });
  toast(days === 1 ? 'Moved to tomorrow' : `Rescheduled to ${days} days from now`, 'good');
}
export const abandon = (ids: string[]) => {
  setStatus(ids, 'dropped', 'Abandon');
  toast('Abandoned — still visible, struck out', 'info');
};

export function duplicate(id: string) {
  commit('Duplicate', (s) => {
    const src = s.nodes.find((n) => n.id === id);
    if (!src) return null;
    const ids = subtree(s.nodes, id);
    const map = new Map<string, string>();
    const copies = s.nodes
      .filter((n) => ids.has(n.id))
      .map((n) => {
        const nid = uid();
        map.set(n.id, nid);
        return { ...n, id: nid, status: (n.smart ? 'waiting' : 'todo') as Status, spent: undefined, lastRun: undefined, created: Date.now(), modified: Date.now() };
      });
    copies.forEach((c) => {
      if (c.parentId && map.has(c.parentId)) c.parentId = map.get(c.parentId)!;
    });
    let last = -1;
    s.nodes.forEach((n, i) => {
      if (ids.has(n.id)) last = i;
    });
    const nodes = [...s.nodes];
    nodes.splice(last + 1, 0, ...copies);
    const copyId = map.get(id)!;
    // keep the copy right after the original inside Next
    let plan = planOf({ ...s, nodes });
    if (src.kind === 'action') {
      plan = plan.map((sg) => ({ ...sg, items: sg.items.filter((x) => x !== copyId) }));
      const si = plan.findIndex((sg) => sg.items.includes(id));
      if (si >= 0) {
        const items = [...plan[si].items];
        items.splice(items.indexOf(id) + 1, 0, copyId);
        plan[si] = { ...plan[si], items };
      } else plan = planOf({ ...s, nodes });
    }
    const segId = plan.find((sg) => sg.items.includes(copyId))?.id ?? null;
    return { nodes, plan, sel: copyId, nsel: src.kind === 'action' ? { card: segId, row: copyId } : s.nsel };
  });
}

/* ---------- organizer tree ops ---------- */
/** swap node with previous/next sibling (moving whole subtrees) */
export function reorder(id: string, dir: -1 | 1) {
  commit('Reorder', (s) => {
    const me = s.nodes.find((n) => n.id === id);
    if (!me) return null;
    const sibs = s.nodes.filter((n) => n.parentId === me.parentId);
    const other = sibs[sibs.findIndex((n) => n.id === id) + dir];
    if (!other) return null;
    const a = subtree(s.nodes, dir === -1 ? other.id : id);
    const b = subtree(s.nodes, dir === -1 ? id : other.id);
    const first = s.nodes.findIndex((n) => a.has(n.id));
    const rest = s.nodes.filter((n) => !a.has(n.id) && !b.has(n.id));
    const A = s.nodes.filter((n) => a.has(n.id));
    const B = s.nodes.filter((n) => b.has(n.id));
    rest.splice(first, 0, ...B, ...A);
    return { nodes: rest };
  });
}

export const canParent = (kind: Kind, parent: Node | null) =>
  (kind === 'project' && parent === null) || (kind === 'task' && parent?.kind === 'project') || (kind === 'action' && parent?.kind === 'task');

/** move subtree under `parentId`, before sibling `beforeId` (null = at the end) */
export function moveNode(id: string, parentId: string | null, beforeId: string | null) {
  commit('Move', (s) => {
    const me = s.nodes.find((n) => n.id === id);
    if (!me || id === beforeId) return null;
    const sub = subtree(s.nodes, id);
    if (parentId && sub.has(parentId)) return null;
    const moved = s.nodes.filter((n) => sub.has(n.id)).map((n) => (n.id === id ? { ...n, parentId, modified: Date.now() } : n));
    const rest = s.nodes.filter((n) => !sub.has(n.id));
    let at: number;
    if (beforeId) at = rest.findIndex((n) => n.id === beforeId);
    else {
      const anchor = parentId ?? null;
      if (anchor) {
        const sb = subtree(rest, anchor);
        at = -1;
        rest.forEach((n, i) => {
          if (sb.has(n.id)) at = i;
        });
        at += 1;
      } else at = rest.length;
    }
    rest.splice(at < 0 ? rest.length : at, 0, ...moved);
    return { nodes: openIt(rest, parentId), sel: id };
  });
}

/* ---------- Next: plan (cards / splits) ops ---------- */
const segOf = (plan: Seg[], itemId: string) => plan.findIndex((sg) => sg.items.includes(itemId));
const withItems = (plan: Seg[], i: number, items: string[]) => plan.map((sg, j) => (j === i ? { ...sg, items } : sg));

export function addAction(ownerId: string, segId: string | undefined, afterId: string | null, text: string): string {
  const node = mk('action', ownerId, text, { today: true });
  commit('Add action', (s) => {
    const sib =
      afterId && s.nodes.some((n) => n.id === afterId && n.parentId === ownerId)
        ? afterId
        : lastChild(s.nodes, ownerId) ?? (s.nodes.some((n) => n.id === ownerId) ? ownerId : null);
    const nodes = openIt(insertAfter(s.nodes, node, sib), ownerId);
    const meetings = s.meetings.map((m) => (m.id === ownerId ? { ...m, open: true } : m));
    let plan = planOf({ ...s, nodes, meetings }).map((sg) => ({ ...sg, items: sg.items.filter((x) => x !== node.id) }));
    const ti = afterId ? segOf(plan, afterId) : plan.findIndex((sg) => sg.id === segId);
    if (ti >= 0) {
      const items = [...plan[ti].items];
      items.splice(afterId ? items.indexOf(afterId) + 1 : 0, 0, node.id);
      plan = withItems(plan, ti, items);
    } else plan = planOf({ ...s, nodes, meetings });
    const card = plan.find((sg) => sg.items.includes(node.id))?.id ?? null;
    return { nodes, meetings, plan, nsel: { card, row: node.id } };
  });
  return node.id;
}

export function addTaskCard(parentId: string | null, title: string, afterSeg: string | null): { id: string; seg: string } {
  const node = mk('task', parentId, title, { today: true });
  commit('Add task', (s) => {
    const nodes = openIt(insertAfter(s.nodes, node, parentId ? lastChild(s.nodes, parentId) ?? parentId : null), parentId);
    const full = planOf({ ...s, nodes });
    const seg = full.find((sg) => sg.owner === node.id)!;
    const plan = full.filter((sg) => sg.id !== seg.id);
    const at = afterSeg ? plan.findIndex((sg) => sg.id === afterSeg) : -1;
    plan.splice(afterSeg === null ? 0 : at < 0 ? plan.length : at + 1, 0, seg);
    return { nodes, plan, nsel: { card: seg.id, row: null } };
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

/** ⌘↑/↓ on an action: reorder inside its card; past the edge it splits out of the card (or moves the card if alone) */
export function moveRow(id: string, dir: -1 | 1) {
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
      const ns: Seg = { id: 's_' + uid(), owner: sg.owner, items: [id] };
      const out = withItems(plan, si, sg.items.filter((x) => x !== id));
      out.splice(dir === -1 ? si : si + 1, 0, ns);
      return { plan: out, nsel: { card: ns.id, row: id } };
    }
    return moveSegPatch(s, plan, sg.id, dir);
  });
}

export function dropRowInSeg(id: string, targetRowId: string, pos: 'before' | 'after') {
  commit('Move action', (s) => {
    if (id === targetRowId || id.startsWith(FX)) return null;
    const plan = planOf(s);
    const si = segOf(plan, id);
    const ti = segOf(plan, targetRowId);
    if (si < 0 || ti < 0 || plan[si].owner !== plan[ti].owner) return null;
    const out = plan.map((sg) => ({ ...sg, items: sg.items.filter((x) => x !== id) }));
    const items = out[ti].items;
    items.splice(items.indexOf(targetRowId) + (pos === 'after' ? 1 : 0), 0, id);
    return { plan: out, nsel: { card: out[ti].id, row: id } };
  });
}

/** dropping an action outside its card splits the task's schedule: same task, a new segment elsewhere */
export function dropRowSplit(id: string, targetSegId: string, pos: 'before' | 'after') {
  commit('Split task', (s) => {
    if (id.startsWith(FX)) return null;
    const plan = planOf(s);
    const si = segOf(plan, id);
    const ti = plan.findIndex((sg) => sg.id === targetSegId);
    if (si < 0 || ti < 0 || (si === ti && plan[si].items.length < 2)) return null;
    const ns: Seg = { id: 's_' + uid(), owner: plan[si].owner, items: [id] };
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

/** bring every segment of the task into this one */
export function consolidate(segId: string) {
  const done = commit('Consolidate', (s) => {
    const plan = planOf(s);
    const t = plan.find((sg) => sg.id === segId);
    if (!t) return null;
    const others = plan.filter((sg) => sg.owner === t.owner && sg.id !== segId);
    if (!others.length) return null;
    const items = [...t.items, ...others.flatMap((o) => o.items)];
    return { plan: plan.filter((sg) => !others.includes(sg)).map((sg) => (sg.id === segId ? { ...sg, items } : sg)) };
  });
  toast(done ? 'Consolidated all actions here' : 'Already all in one place', done ? 'good' : 'info');
}

/* ---------- start / stopwatch / focus ---------- */
export function startAction(id: string) {
  const n = get().nodes.find((x) => x.id === id);
  if (!n || n.kind !== 'action') return;
  if (n.smart) return toast(`(mock) opening ${n.title.split('\n')[0]} in browser`);
  commit('Start', (s) => {
    const at = Date.now();
    let nodes = stopCurrent(s.nodes, s.current, at);
    nodes = nodes.map((x) => (x.id === id ? { ...x, status: 'doing', lastRun: at, today: true, later: undefined, modified: at } : x));
    // starting moves the action — and its card — to the top of the stack
    let plan = planOf({ ...s, nodes });
    const si = segOf(plan, id);
    if (si >= 0) {
      const seg = { ...plan[si], items: [id, ...plan[si].items.filter((x) => x !== id)] };
      plan = [seg, ...plan.filter((_, j) => j !== si)];
    }
    return {
      nodes,
      plan,
      current: { id, since: at },
      nsel: { card: plan[0]?.id ?? null, row: id },
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
/** enter on a task / project / card: start its first open action */
export function startFirst(nodeId: string) {
  const s = get();
  const sub = subtree(s.nodes, nodeId);
  const n = s.nodes.find((x) => sub.has(x.id) && startable(x));
  if (n) startAction(n.id);
  else toast('No open actions to start here');
}
export function startCard(c: CardM) {
  if (c.kind === 'attention') return toast(`(mock) opening ${c.rows[0].node!.title.split('\n')[0]} in browser`);
  const r = c.rows.find((x) => x.node && startable(x.node));
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
  set((s) => ({ focus: null, layout: s.prevLayout, tab: 'next', clock: s.clock + elapsed }));
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

/** file an inbox item: onto a project => new task; onto a task => new action */
export function fileInbox(itemId: string, targetId: string) {
  const item = get().inbox.find((i) => i.id === itemId);
  const target = get().nodes.find((n) => n.id === targetId);
  if (!item || !target) return;
  const kind: Kind = target.kind === 'project' ? 'task' : 'action';
  const node = mk(kind, target.id, item.text);
  commit(`File "${item.text.slice(0, 24)}"`, (s) => {
    const nodes = openIt(insertAfter(s.nodes, node, lastChild(s.nodes, target.id) ?? target.id), target.id);
    const idx = s.inbox.findIndex((i) => i.id === itemId);
    const next = s.inbox[idx + 1] ?? s.inbox[idx - 1];
    return { nodes, inbox: s.inbox.filter((i) => i.id !== itemId), sel: target.id, isel: next?.id ?? null };
  });
  toast(`Filed under ${target.title}`, 'good');
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
  if (!t || t.kind === 'project') return;
  set(() => ({ aiBusy: `Breaking down "${t.title.split('\n')[0]}"…` }));
  await sleep(get().aiDelay);
  const steps = aiBreakdown(t.title.split('\n')[0]);
  commit('AI breakdown', (s) => {
    let nodes = s.nodes;
    let after = lastChild(nodes, taskId) ?? taskId;
    for (const st of steps) {
      const node = mk('action', taskId, st.title, { est: st.est, today: t.today });
      nodes = insertAfter(nodes, node, after);
      after = node.id;
    }
    return { nodes: openIt(nodes, taskId), sel: taskId };
  });
  set(() => ({ aiBusy: null }));
  toast(`Added ${steps.length} actions to "${t.title.split('\n')[0]}"`, 'good');
}

export async function estimate(id: string) {
  set(() => ({ aiBusy: 'Estimating effort…' }));
  await sleep(get().aiDelay);
  const ids = actionIdsUnder(get().nodes, id).filter((a) => !get().nodes.find((n) => n.id === a)!.est);
  patchNodes('AI estimate', ids, (n) => ({ est: aiEstimate(n.title) }));
  set(() => ({ aiBusy: null }));
  toast(ids.length ? `Estimated ${ids.length} action(s) from similar past work` : 'Nothing to estimate', ids.length ? 'good' : 'info');
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
  toast(ids.length ? `Added ${ids.length} actions to Next (fits around your meetings)` : 'Next already looks full', 'good');
}

/* ---------- AI popup (⌘/) ---------- */
export function openAi(ctxId?: string) {
  const s = get();
  const node = ctxId ? s.nodes.find((n) => n.id === ctxId) : undefined;
  const meeting = ctxId ? s.meetings.find((m) => m.id === ctxId) : undefined;
  const ctx = node ? node.title.split('\n')[0] : meeting?.title;
  set(() => ({ ai: { ctx, ctxId, msgs: [], busy: false }, menu: null }));
}
export function closeAi() {
  set(() => ({ ai: null }));
  focusArea();
}
export async function askAi(text: string) {
  text = text.trim();
  const a0 = get().ai;
  if (!text || !a0 || a0.busy) return;
  set((s) => ({ ai: s.ai && { ...s.ai, busy: true, msgs: [...s.ai.msgs, { id: uid(), role: 'user', text }] } }));
  await sleep(get().aiDelay + 500);
  const s = get();
  if (!s.ai) return;
  const r = aiReply(text, s.ai.ctx, s);
  const chips: { label: string; run: () => void }[] = [];
  if (r.intent === 'plan') chips.push({ label: '✨ Plan my day', run: () => planToday() });
  if (r.intent === 'breakdown' && s.ai.ctxId && s.nodes.some((n) => n.id === s.ai!.ctxId && n.kind !== 'project'))
    chips.push({ label: '✨ Add as actions', run: () => breakDown(s.ai!.ctxId!) });
  set((st) => ({ ai: st.ai && { ...st.ai, busy: false, msgs: [...st.ai.msgs, { id: uid(), role: 'ai', text: r.text, chips: chips.length ? chips : undefined }] } }));
}

/* ---------- mock desktop controls ---------- */
const flagToasts: Partial<Record<keyof Flags, { text: string; tone: Toast['tone'] }>> = {
  prBuildFailing: { text: 'PR #482: build failed (unit-tests)', tone: 'bad' },
  prNewComments: { text: 'PR #482: 3 new review comments', tone: 'warn' },
  prApproved: { text: 'PR #482 approved — ready to merge', tone: 'good' },
  pipelineFailed: { text: 'Deploy 2.4 failed at prod-eu', tone: 'bad' },
  workItemChanged: { text: 'WI 18233 moved to Resolved', tone: 'warn' },
  aiNeedsFeedback: { text: 'Claude session is waiting for your input', tone: 'warn' },
  aiDone: { text: 'Claude session finished: 14 files changed', tone: 'good' },
  meetingMoved: { text: 'Design review moved to 11:30 (was 14:00)', tone: 'warn' },
};

export function setFlag(k: keyof Flags, v: boolean) {
  set((s) => ({ flags: { ...s.flags, [k]: v } }));
  if (v && flagToasts[k]) toast(flagToasts[k]!.text, flagToasts[k]!.tone);
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
