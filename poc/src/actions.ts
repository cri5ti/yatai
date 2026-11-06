import { get, set, uid, seedInbox } from './store';
import type { Flags, FocusState, Kind, Layout, Node, Tab, Toast } from './store';
import { aiBreakdown, aiEstimate, aiPlan, aiSuggest, sleep } from './mock';
import { fmt, meetingsFor } from './model';

/* ---------- toasts ---------- */
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = uid();
  set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => dismissToast(id), 6500);
}
export const dismissToast = (id: string) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/* ---------- navigation / window ---------- */
export const setTab = (tab: Tab) => set(() => ({ tab, hidden: false }));
export const setLayout = (layout: Layout) => set(() => ({ layout, hidden: false }));
export const toggleHidden = () => set((s) => ({ hidden: !s.hidden }));
export const openCapture = () => set(() => ({ capture: true }));
export const closeCapture = () => set(() => ({ capture: false }));

/* ---------- nodes ---------- */
export function patch(id: string, p: Partial<Node>) {
  set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...p, modified: Date.now() } : n)) }));
}

export function addNode(kind: Kind, parentId: string | null, title = '', afterId?: string): string {
  const id = uid();
  const node: Node = {
    id, parentId, kind, title,
    status: 'todo', today: false, open: true,
    created: Date.now(), modified: Date.now(),
  };
  set((s) => {
    const nodes = [...s.nodes];
    // insert after afterId (or after its last descendant) to keep sibling order
    if (afterId) {
      const idx = lastDescendantIndex(nodes, afterId);
      nodes.splice(idx + 1, 0, node);
    } else nodes.push(node);
    return {
      nodes: nodes.map((n) => (n.id === parentId ? { ...n, open: true } : n)),
      sel: id,
    };
  });
  return id;
}

function lastDescendantIndex(nodes: Node[], id: string): number {
  let idx = nodes.findIndex((n) => n.id === id);
  const ids = new Set([id]);
  for (let i = idx + 1; i < nodes.length; i++) {
    if (nodes[i].parentId && ids.has(nodes[i].parentId!)) {
      ids.add(nodes[i].id);
      idx = i;
    }
  }
  return idx;
}

export function removeNode(id: string) {
  set((s) => {
    const kill = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of s.nodes) if (n.parentId && kill.has(n.parentId) && !kill.has(n.id)) (kill.add(n.id), (grew = true));
    }
    return { nodes: s.nodes.filter((n) => !kill.has(n.id)) };
  });
}

export function toggleDone(id: string) {
  const n = get().nodes.find((x) => x.id === id);
  if (n) patch(id, { status: n.status === 'done' ? 'todo' : 'done' });
}
export function toggleToday(id: string) {
  const n = get().nodes.find((x) => x.id === id);
  if (n) patch(id, { today: !n.today });
}
export const toggleOpen = (id: string, open: boolean) =>
  set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, open } : n)) }));

/** swap node with previous/next sibling (moving whole subtrees) */
export function reorder(id: string, dir: -1 | 1) {
  set((s) => {
    const me = s.nodes.find((n) => n.id === id)!;
    const sibs = s.nodes.filter((n) => n.parentId === me.parentId);
    const i = sibs.findIndex((n) => n.id === id);
    const other = sibs[i + dir];
    if (!other) return {};
    const subtree = (rootId: string) => {
      const ids = new Set([rootId]);
      return s.nodes.filter((n) => {
        if (n.id === rootId) return true;
        if (n.parentId && ids.has(n.parentId)) return (ids.add(n.id), true);
        return false;
      });
    };
    const a = subtree(dir === -1 ? other.id : id);
    const b = subtree(dir === -1 ? id : other.id);
    const aIds = new Set(a.map((n) => n.id));
    const bIds = new Set(b.map((n) => n.id));
    const firstIdx = s.nodes.findIndex((n) => aIds.has(n.id));
    const rest = s.nodes.filter((n) => !aIds.has(n.id) && !bIds.has(n.id));
    const out = [...rest];
    out.splice(firstIdx, 0, ...b, ...a);
    return { nodes: out };
  });
}

/* ---------- inbox ---------- */
export function capture(text: string) {
  text = text.trim();
  if (!text) return;
  set((s) => ({ inbox: [{ id: uid(), text, created: Date.now() }, ...s.inbox] }));
}
export const dropInbox = (id: string) => set((s) => ({ inbox: s.inbox.filter((i) => i.id !== id) }));

/** file an inbox item: onto a project => new task; onto a task => new action */
export function fileInbox(itemId: string, targetId: string) {
  const item = get().inbox.find((i) => i.id === itemId);
  const target = get().nodes.find((n) => n.id === targetId);
  if (!item || !target) return;
  const kind: Kind = target.kind === 'project' ? 'task' : 'action';
  addNode(kind, target.id, item.text);
  set(() => ({ sel: targetId }));
  dropInbox(itemId);
  toast(`Filed under ${target.title}`, 'good');
}

export async function suggestInbox(ids?: string[]) {
  const s = get();
  const targets = (ids ?? s.inbox.filter((i) => !i.suggestion).map((i) => i.id));
  set((st) => ({ aiBusy: 'Organizing inbox…', inbox: st.inbox.map((i) => (targets.includes(i.id) ? { ...i, suggesting: true } : i)) }));
  await sleep(get().aiDelay);
  set((st) => ({
    aiBusy: null,
    inbox: st.inbox.map((i) => (targets.includes(i.id) ? { ...i, suggesting: false, suggestion: aiSuggest(i.text, st.nodes) } : i)),
  }));
}
export const clearSuggestion = (id: string) =>
  set((s) => ({ inbox: s.inbox.map((i) => (i.id === id ? { ...i, suggestion: null } : i)) }));

/* ---------- AI (mocked) ---------- */
export async function breakDown(taskId: string) {
  const t = get().nodes.find((n) => n.id === taskId);
  if (!t || t.kind === 'project') return;
  set(() => ({ aiBusy: `Breaking down "${t.title}"…` }));
  await sleep(get().aiDelay);
  const steps = aiBreakdown(t.title);
  let after = taskId;
  const base = get().nodes.filter((n) => n.parentId === taskId);
  if (base.length) after = base[base.length - 1].id;
  for (const st of steps) {
    const id = addNode('action', taskId, st.title, after);
    patch(id, { est: st.est });
    after = id;
  }
  set(() => ({ aiBusy: null, sel: taskId }));
  toast(`Added ${steps.length} actions to "${t.title}"`, 'good');
}

export async function estimate(id: string) {
  const s = get();
  set(() => ({ aiBusy: 'Estimating effort…' }));
  await sleep(s.aiDelay);
  const targets = s.nodes.filter((n) => n.kind === 'action' && (n.id === id || isUnder(s.nodes, n.id, id)) && !n.est);
  for (const n of targets) patch(n.id, { est: aiEstimate(n.title) });
  set(() => ({ aiBusy: null }));
  toast(targets.length ? `Estimated ${targets.length} action(s) from similar past work` : 'Nothing to estimate', targets.length ? 'good' : 'info');
}

function isUnder(nodes: Node[], id: string, ancestor: string): boolean {
  let cur = nodes.find((n) => n.id === id)?.parentId;
  while (cur) {
    if (cur === ancestor) return true;
    cur = nodes.find((n) => n.id === cur)?.parentId ?? null;
  }
  return false;
}

export async function planToday() {
  set(() => ({ aiBusy: 'Planning your day…' }));
  await sleep(get().aiDelay + 400);
  const ids = aiPlan(get());
  set((s) => ({ aiBusy: null, nodes: s.nodes.map((n) => (ids.includes(n.id) ? { ...n, today: true } : n)) }));
  toast(ids.length ? `Added ${ids.length} actions to today (fits around your meetings)` : 'Today already looks full', 'good');
}

/* ---------- focus ---------- */
export function startFocus(nodeId: string, durationMin = 25) {
  const n = get().nodes.find((x) => x.id === nodeId);
  if (!n) return;
  patch(nodeId, { status: n.status === 'done' ? 'todo' : 'doing', lastRun: Date.now() });
  const f: FocusState = { nodeId, durationMin, startedAt: Date.now(), pausedTotal: 0, extra: 0, ended: false };
  set((s) => ({ focus: f, prevLayout: s.layout === 'pill' ? s.prevLayout : s.layout, hidden: false }));
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
export const extendFocus = (m: number) => set((s) => (s.focus ? { focus: { ...s.focus, extra: s.focus.extra + m, ended: false, elapsedAtEnd: undefined } } : {}));

/** leave focus; optionally mark done / start next */
export function leaveFocus(opts: { done?: boolean; next?: string } = {}) {
  const f = get().focus;
  if (!f) return;
  const elapsed = f.elapsedAtEnd ?? focusElapsedMin(f);
  if (opts.done) patch(f.nodeId, { status: 'done' });
  else patch(f.nodeId, { status: 'todo' });
  set((s) => ({ focus: null, layout: s.prevLayout, tab: 'today', clock: s.clock + elapsed }));
  if (opts.next) startFocus(opts.next);
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
  const s = get();
  const before = meetingsFor(s);
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
  set((s) => ({ inbox: [...seedInbox().slice(0, 3), ...s.inbox] }));
}
