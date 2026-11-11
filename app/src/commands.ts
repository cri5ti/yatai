import { get, set, uid } from './store';
import type { MenuItem, Node, Target } from './store';
import { nextModel, plain, refsOf } from './model';
import type { CardM } from './model';
import { EST_KEYS } from './kbd';
import { breadcrumb } from './mock';
import * as A from './actions';
import { PRESETS, remindLabel } from './remind';

/* Every level (card, action, organizer row, inbox item) shares one command list, reachable by
 * right-click or by the "/" key (which adds a type-to-filter input: /consolidate, /due, …). */

const estWords = (m: number) => (m >= 60 ? `${m / 60} h` : `${m} min`);

export const estItems = (ids: string[]): MenuItem[] => [
  ...EST_KEYS.map(([key, m]) => ({ id: 'est' + m, label: estWords(m), key, run: () => A.setEst(ids, m) })),
  { id: 'est0', label: 'No estimate', key: '0', run: () => A.setEst(ids, undefined) },
];
const dueItems = (ids: string[]): MenuItem[] => [
  { id: 'd0', label: 'Today', key: '1', run: () => A.setDue(ids, 0) },
  { id: 'd1', label: 'Tomorrow', key: '2', run: () => A.setDue(ids, 1) },
  { id: 'd3', label: 'In 3 days', key: '3', run: () => A.setDue(ids, 3) },
  { id: 'd7', label: 'Next week', key: '4', run: () => A.setDue(ids, 7) },
  {
    id: 'dpick',
    label: 'Pick a date…',
    key: '5',
    icon: '📅',
    tip: 'A calendar — or type fri, +3, +2w, nov 20, 2026-12-01',
    date: { value: get().nodes.find((n) => n.id === ids[0])?.due, pick: (iso) => A.setDueOn(ids, iso) },
  },
  { id: 'dn', label: 'Clear due date', key: '0', run: () => A.setDue(ids, null) },
];
const reschedItems = (ids: string[]): MenuItem[] => [
  { id: 'r1', label: 'Tomorrow', key: '1', run: () => A.deferTo(ids, 1) },
  { id: 'r2', label: 'In 2 days', key: '2', run: () => A.deferTo(ids, 2) },
  { id: 'r7', label: 'Next week', key: '3', run: () => A.deferTo(ids, 7) },
  { id: 'r30', label: 'Next month', key: '4', run: () => A.deferTo(ids, 30) },
];
const meetingMoves = (id: string): MenuItem[] => [
  { id: 'm15', label: '+15 min', key: '1', run: () => A.rescheduleMeeting(id, 15) },
  { id: 'm30', label: '+30 min', key: '2', run: () => A.rescheduleMeeting(id, 30) },
  { id: 'm60', label: '+1 hour', key: '3', run: () => A.rescheduleMeeting(id, 60) },
  { id: 'mm15', label: '−15 min', key: '4', run: () => A.rescheduleMeeting(id, -15) },
];

/** /remind: come back to it later (it returns to Next, highlighted, with a notification) */
const remindItems = (ids: string[]): MenuItem[] => {
  const has = get().nodes.some((n) => ids.includes(n.id) && n.remind);
  return [
    ...PRESETS.map((p) => ({ id: p.id, label: p.label, key: p.key, tip: p.id === 'rtom' || p.id === 'rmon' ? 'At the start of your working day (Settings → working hours)' : undefined, run: () => A.remindIn(ids, p.id) })),
    { id: 'rcustom', label: 'Custom…', key: '9', icon: '⌨', tip: 'Type a time: 20m · 1h30 · 14:30 · fri · fri 10:00 · tomorrow 15:00 · nov 20 9am', when: { pick: (at: number) => A.setRemind(ids, at) } },
    ...(has ? [{ id: 'rclear', label: 'Clear reminder', key: '0', run: () => A.setRemind(ids, null) }] : []),
  ];
};
const remindLabelFor = (ids: string[]) => {
  const at = get().nodes.find((n) => n.id === ids[0])?.remind;
  return at && ids.length === 1 ? `Remind me… (${remindLabel(at)})` : 'Remind me…';
};

/** opens the little 1–5 picker under the selection */
const prioItem = (ids: string[]): MenuItem => ({
  id: 'prio', label: 'Priority…', cmd: 'priority', keys: '⌃1–5', icon: '◆',
  run: () => {
    const at = anchor();
    A.openPrioPick(ids, at.x + 140, at.y);
  },
});

const edit = (id: string) => set(() => ({ edit: id, menu: null }));

interface Ctx {
  card?: CardM; // set when the menu is for something in the Next view
  row?: boolean; // ...and it is a row rather than the card header
}

/** one menu for every item, at any level: what is offered depends on whether it has children, not on a "type" */
/** an item card folds by its item; a meeting by itself */
const folded = (c: CardM) => (c.kind === 'task' ? c.task?.open === false : c.collapsed);

function itemMenu(n: Node, c: Ctx): MenuItem[] {
  const nodes = get().nodes;
  const kids = nodes.some((x) => x.parentId === n.id);
  const running = get().current?.id === n.id;
  const all = [...A.subtreeIds(nodes, [n.id])];
  const leaves = nodes.filter((x) => all.includes(x.id) && !nodes.some((y) => y.parentId === x.id)).map((x) => x.id);
  const parts = c.card?.part?.n ?? 1;
  const rowsOnly = !!c.row;
  const items: MenuItem[] = [
    kids
      ? { id: 'start', label: 'Start first action', cmd: 'start', keys: '⇧Space', icon: '▶', run: () => A.startFirst(n.id) }
      : { id: 'start', label: running ? 'Pause' : 'Start', cmd: 'start', keys: '⇧Space', icon: running ? '❚❚' : '▶', run: () => A.toggleStart(n.id) },
    { id: 'focus', label: 'Start in focus mode', cmd: 'focus', keys: '⌘⇧⏎', icon: '◎', run: () => (kids ? (A.startFirst(n.id), get().current && A.startFocus(get().current!.id)) : A.startFocus(n.id)) },
    { id: 'done', label: A.isDone(nodes, n.id) ? 'Mark not done' : 'Mark done', cmd: 'done', keys: 'Space', icon: '✓', run: () => A.toggleDoneNodes([n.id]) },
    { id: 'edit', label: 'Edit', cmd: 'edit', keys: 'F2', icon: '✎', run: () => edit(n.id) },
  ];
  if (c.card && !c.row)
    items.push({
      id: 'newaction',
      label: 'New item inside',
      cmd: 'new',
      keys: '→',
      icon: '＋',
      run: () => set(() => ({ menu: null, nsel: { card: c.card!.key, row: c.card!.rows[0]?.head ? n.id : null }, ins: { kind: 'action', owner: n.id, seg: c.card!.seg?.id, after: lastRow(c.card) } })),
    });
  else if (c.card)
    items.push({
      id: 'newaction',
      label: 'New item below',
      cmd: 'new',
      keys: '⌘⏎',
      icon: '＋',
      run: () => set(() => ({ menu: null, ins: { kind: 'action', owner: c.card!.ownerId, seg: c.card!.seg?.id, after: n.id } })),
    });
  if (c.card && c.row)
    items.push({ id: 'newabove', label: 'New item above', cmd: 'above', keys: '⇧⏎', icon: '＋', run: () => set(() => ({ menu: null, ins: { kind: 'action', owner: c.card!.ownerId, seg: c.card!.seg?.id, after: null, before: n.id } })) });
  if (!c.card) {
    items.push({ id: 'newabove', label: 'New item above', cmd: 'above', keys: '⇧⏎', icon: '＋', run: () => set(() => ({ menu: null, ins: { kind: 'node', parentId: n.parentId, afterId: null, beforeId: n.id } })) });
    items.push({ id: 'newbelow', label: 'New item below', cmd: 'new', keys: '⏎', icon: '＋', run: () => set(() => ({ menu: null, ins: { kind: 'node', parentId: n.parentId, afterId: n.id } })) });
    items.push({
      id: 'newchild',
      label: 'New sub-item',
      cmd: 'child',
      keys: 'A',
      icon: '↳',
      run: () => set(() => ({ menu: null, ins: { kind: 'node', parentId: n.id, afterId: A_lastChild(n.id) ?? n.id } })),
    });
  }
  items.push({ id: 'indent', label: 'Indent (into the item above)', cmd: 'indent', keys: '⌘]', icon: '⇥', run: () => A.indentItems([n.id], rowsOnly) });
  items.push({ id: 'outdent', label: 'Outdent (up a level)', cmd: 'outdent', keys: '⌘[', icon: '⇤', run: () => A.outdentItems([n.id]) });
  if (c.card && !c.row && c.card.kind === 'task') {
    // sub-items of rows in this card that were dragged out into cards of their own come back too
    const here = A.subtreeIds(nodes, c.card.seg?.items ?? []);
    const pulledOut = nextModel(get()).cards.some((x) => x.seg?.pulled && x.key !== c.card!.key && here.has(x.ownerId));
    const split = parts > 1 || pulledOut;
    items.push({
      id: 'consolidate',
      label: 'Consolidate',
      cmd: 'consolidate',
      icon: '⇲',
      disabled: !split,
      tip: split ? 'Consolidate all your actions here' : 'Consolidate all your actions here (this task is not split)',
      run: () => A.consolidate(c.card!.key),
    });
  }
  items.push({ id: 'estimate', label: 'Estimate…', cmd: 'estimate', keys: 'E', icon: '⏱', sub: estItems([n.id]) });
  items.push(prioItem([n.id]));
  items.push({ id: 'breakdown', label: 'Break down with AI', cmd: 'breakdown', keys: 'B', icon: '✨', run: () => A.breakDown(n.id) });
  if (kids) items.push({ id: 'estai', label: 'Estimate all with AI', cmd: 'estimate-ai', icon: '✨', run: () => A.estimate(n.id) });
  if (c.card && !c.row)
    items.push({ id: 'fold', label: folded(c.card) ? 'Expand' : 'Collapse', cmd: 'collapse', keys: folded(c.card) ? '→' : '←', icon: '▾', run: () => A.toggleCardOpen(c.card!, folded(c.card!)) });
  if (refsOf(n).length) items.push({ id: 'refresh', label: 'Refresh', cmd: 'refresh', icon: '↻', tip: 'Ask GitHub / DevOps about it now', run: () => void A.refreshItems([n.id]) });
  if (refsOf(n).length)
    items.push({ id: 'notify', label: n.notify ? 'Stop notifying me' : 'Notify me when it changes', cmd: 'notify', icon: n.notify ? '🔕' : '🔔', tip: 'Every change of its state (queued, building, failed, done…): a toast and a system notification when yatai is in the background', run: () => A.toggleNotify([n.id]) });
  items.push({ id: 'due', label: 'Due date…', cmd: 'due', icon: '⚑', sub: dueItems([n.id]) });
  items.push({ id: 'remind', label: remindLabelFor([n.id]), cmd: 'remind', icon: '⏰', tip: 'Come back to it later: it returns to Next, highlighted, with a notification', sub: remindItems([n.id]) });
  items.push({ id: 'tomorrow', label: 'Move to tomorrow', cmd: 'tomorrow', icon: '☾', run: () => A.deferTo([n.id], 1) });
  items.push({ id: 'reschedule', label: 'Reschedule…', cmd: 'reschedule', icon: '↻', sub: reschedItems([n.id]) });
  // fully in Next: the item and everything open under it; partly: some of it (then both are offered)
  const leafNodes = leaves.map((l) => nodes.find((x) => x.id === l)!).filter((x) => x.status !== 'done' && x.status !== 'dropped');
  const full = kids ? n.today && leafNodes.every((x) => x.today) : n.today;
  const some = n.today || (kids && leaves.some((l) => nodes.find((x) => x.id === l)!.today));
  if (!full) items.push({ id: 'plan', label: some ? 'Add all of it to Next' : 'Add to Next', cmd: 'plan', keys: 'T', icon: '★', run: () => A.toggleToday(n.id) });
  if (some) items.push({ id: 'unplan', label: 'Remove from Next', cmd: 'remove', keys: full ? 'T' : undefined, icon: '⊖', run: () => A.unplan([n.id]) });
  items.push({ id: 'duplicate', label: 'Duplicate', cmd: 'duplicate', icon: '⧉', run: () => A.duplicate([n.id]) });
  items.push({ id: 'abandon', label: 'Abandon', cmd: 'abandon', icon: '⊘', run: () => A.abandon([n.id]) });
  items.push({ id: 'delete', label: 'Delete', cmd: 'delete', keys: '⌫', icon: '🗑', danger: true, run: () => A.removeNodes([n.id]) });
  items.push({ id: 'ai', label: 'Ask AI about this', cmd: 'ai', keys: '⌘/', icon: '✨', run: () => A.openAi(n.id) });
  return items;
}
/** the last row directly under the card's item (or at the top level of a card without one) */
const lastRow = (c?: CardM) => {
  const top = c?.rows[0]?.head ? 1 : 0;
  return c?.rows.filter((r) => r.depth === top && !r.head).slice(-1)[0]?.id ?? null;
};
const A_lastChild = (id: string) => [...get().nodes].reverse().find((n) => n.parentId === id)?.id ?? null;

/** the menu for a multi-selection: the bulk-capable subset */
function bulkMenu(ids: string[], rowsOnly: boolean): MenuItem[] {
  return [
    { id: 'done', label: `Mark ${ids.length} done / not done`, cmd: 'done', keys: 'Space', icon: '✓', run: () => A.toggleDoneNodes(ids) },
    { id: 'indent', label: 'Indent', cmd: 'indent', keys: '⌘]', icon: '⇥', run: () => A.indentItems(ids, rowsOnly) },
    { id: 'outdent', label: 'Outdent', cmd: 'outdent', keys: '⌘[', icon: '⇤', run: () => A.outdentItems(ids) },
    { id: 'estimate', label: 'Estimate…', cmd: 'estimate', keys: 'E', icon: '⏱', sub: estItems(ids) },
    prioItem(ids),
    { id: 'due', label: 'Due date…', cmd: 'due', icon: '⚑', sub: dueItems(ids) },
    { id: 'remind', label: remindLabelFor(ids), cmd: 'remind', icon: '⏰', sub: remindItems(ids) },
    { id: 'tomorrow', label: 'Move to tomorrow', cmd: 'tomorrow', icon: '☾', run: () => A.deferTo(ids, 1) },
    { id: 'reschedule', label: 'Reschedule…', cmd: 'reschedule', icon: '↻', sub: reschedItems(ids) },
    { id: 'plan', label: 'Add to Next', cmd: 'plan', icon: '★', run: () => A.addToNext(ids) },
    { id: 'unplan', label: 'Remove from Next', cmd: 'remove', icon: '⊖', run: () => A.unplan(ids) },
    ...(ids.some((id) => { const x = get().nodes.find((n) => n.id === id); return !!x && refsOf(x).length > 0; })
      ? [
          { id: 'refresh', label: 'Refresh', cmd: 'refresh', icon: '↻', run: () => void A.refreshItems(ids) },
          { id: 'notify', label: 'Notify me when they change (toggle)', cmd: 'notify', icon: '🔔', run: () => A.toggleNotify(ids) },
        ]
      : []),
    { id: 'duplicate', label: 'Duplicate', cmd: 'duplicate', icon: '⧉', run: () => A.duplicate(ids) },
    { id: 'abandon', label: 'Abandon', cmd: 'abandon', icon: '⊘', run: () => A.abandon(ids) },
    { id: 'delete', label: `Delete ${ids.length} items`, cmd: 'delete', keys: '⌫', icon: '🗑', danger: true, run: () => A.removeNodes(ids) },
  ];
}

function meetingItems(c: CardM): MenuItem[] {
  const m = c.meeting!;
  return [
    { id: 'join', label: 'Join', cmd: 'start', keys: '⇧Space', icon: '📅', run: () => A.toast(`(mock) joining ${m.title}`) },
    {
      id: 'newaction',
      label: 'New prep action',
      cmd: 'new',
      keys: '⌘⏎',
      icon: '＋',
      run: () => set(() => ({ menu: null, nsel: { card: c.key, row: null }, ins: { kind: 'action', owner: m.id, seg: c.key, after: null } })),
    },
    { id: 'reschedule', label: 'Reschedule…', cmd: 'reschedule', icon: '↻', sub: meetingMoves(m.id) },
    { id: 'fold', label: c.collapsed ? 'Expand' : 'Collapse', cmd: 'collapse', icon: '▾', run: () => A.toggleCardOpen(c, c.collapsed) },
    { id: 'delete', label: 'Delete meeting', cmd: 'delete', keys: '⌫', icon: '🗑', danger: true, tip: 'Removes it from yatai only — bring it back any time from the Outlook drawer', run: () => A.removeMeeting(m.id) },
    { id: 'ai', label: 'Ask AI about this', cmd: 'ai', keys: '⌘/', icon: '✨', run: () => A.openAi(m.id) },
  ];
}

function inboxItems(id: string): MenuItem[] {
  const s = get();
  const it = s.inbox.find((i) => i.id === id);
  if (!it) return [];
  const items: MenuItem[] = [];
  if (it.suggestion) {
    const sg = it.suggestion;
    items.push({ id: 'accept', label: `Accept: ${breadcrumb(s.nodes, sg.parentId)}`, cmd: 'accept', keys: 'A', icon: '✨', tip: sg.reason, run: () => A.fileInbox(id, sg.parentId) });
  }
  items.push({ id: 'file', label: 'File into…', cmd: 'file', keys: 'F', icon: '→', sub: fileTargets(id) });
  items.push({ id: 'suggest', label: 'Suggest with AI', cmd: 'suggest', keys: 'S', icon: '✨', run: () => A.suggestInbox([id]) });
  items.push({ id: 'edit', label: 'Edit', cmd: 'edit', keys: 'F2', icon: '✎', run: () => edit(id) });
  items.push({ id: 'discard', label: 'Discard', cmd: 'discard', keys: '⌫', icon: '🗑', danger: true, run: () => A.dropInbox(id) });
  items.push({ id: 'ai', label: 'Ask AI about this', cmd: 'ai', keys: '⌘/', icon: '✨', run: () => A.openAi() });
  return items;
}
export const fileTargets = (inboxId: string): MenuItem[] =>
  get()
    .nodes.filter((n) => !n.parentId || get().nodes.some((p) => p.id === n.parentId))
    .map((n) => ({
      id: 'f' + n.id,
      label: breadcrumb(get().nodes, n.id),
      cmd: breadcrumb(get().nodes, n.id).toLowerCase(),
      tip: 'Becomes a new item inside',
      icon: '↳',
      run: () => A.fileInbox(inboxId, n.id),
    }));

function build(t: Target): { title: string; items: MenuItem[] } | null {
  const s = get();
  if (t.t === 'inbox') return { title: 'Inbox item', items: inboxItems(t.id) };
  if (t.t === 'multi') return { title: `${t.ids.length} items selected`, items: bulkMenu(t.ids, s.tab === 'next') };
  if (t.t === 'node') {
    const n = s.nodes.find((x) => x.id === t.id);
    return n ? { title: plain(n.title.split('\n')[0]), items: itemMenu(n, {}) } : null;
  }
  if (t.t === 'row') {
    const c = nextModel(s).cards.find((x) => x.rows.some((r) => r.id === t.id));
    const r = c?.rows.find((x) => x.id === t.id);
    if (!c || !r) return null;
    if (r.fx) return { title: r.fx.title, items: meetingItems(c) };
    // a card's own item (its top row when it is not in Next itself) carries the card's commands
    return { title: plain(r.node!.title.split('\n')[0]), items: itemMenu(r.node!, r.head ? { card: c } : { card: c, row: true }) };
  }
  const c = nextModel(s).cards.find((x) => x.key === t.key);
  if (!c) return null;
  if (c.kind === 'meeting') return { title: c.meeting!.title, items: meetingItems(c) };
  if (!c.task) return null;
  return { title: plain(c.task.title.split('\n')[0]), items: itemMenu(c.task, { card: c }) };
}

function anchor() {
  const el = document.querySelector('[data-sel="true"]') as HTMLElement | null;
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + 28, y: r.bottom + 4 };
  }
  return { x: window.innerWidth / 2 - 130, y: 140 };
}

/** right-click (x, y given) or "/" (anchored under the selected element, with the type-to-filter input focused) */
export function openMenu(t: Target | null, x?: number, y?: number, o: { slash?: boolean } = {}) {
  if (!t) return;
  const b = build(t);
  if (!b) return;
  const at = x == null || y == null ? anchor() : { x, y };
  set(() => ({ menu: { id: uid(), x: at.x, y: at.y, title: b.title, items: b.items, slash: !!o.slash } }));
}

/** direct estimate picker (the "E" key, or clicking an estimate chip) */
export function openEstMenu(ids: string[], x?: number, y?: number) {
  const at = x == null || y == null ? anchor() : { x, y };
  set(() => ({ menu: { id: uid(), x: at.x, y: at.y, title: 'Estimate', items: estItems(ids), slash: false } }));
}

export function openFileMenu(inboxId: string, x?: number, y?: number) {
  const at = x == null || y == null ? anchor() : { x, y };
  set(() => ({ menu: { id: uid(), x: at.x, y: at.y, title: 'File into…', items: fileTargets(inboxId), slash: true } }));
}

