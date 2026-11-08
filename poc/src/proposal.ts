import { useMemo } from 'react';
import { commit, get, set, uid, useS } from './store';
import type { AiOp, Node, PatchKey, State, Status, SubSpec } from './store';

/**
 * AI proposals. The AI never edits the document: its write tools append ops to `state.proposal`.
 * The views render the document *with the ops applied* and mark what they touch in purple;
 * accepting commits the result as one undo step, rejecting just drops the ops.
 * Ops are re-applied to the current document every time, so they never go stale.
 */

export type MarkKind = 'add' | 'change' | 'remove';
export interface Mark {
  kind: MarkKind;
  prev: Partial<Record<PatchKey | 'parent', unknown>>; // old values of the changed keys ('parent': moved here from elsewhere)
}
export type Marks = Record<string, Mark>;

export const STATUSES: Status[] = ['todo', 'doing', 'waiting', 'done', 'dropped'];

const touch = (marks: Marks, id: string, key: PatchKey | 'parent', prev: unknown) => {
  const m = (marks[id] ??= { kind: 'change', prev: {} });
  if (m.kind === 'change' && !(key in m.prev)) m.prev[key] = prev;
};

function patchOne(nodes: Node[], marks: Marks, id: string, p: Extract<AiOp, { op: 'patch' }>['set']): Node[] {
  return nodes.map((n) => {
    if (n.id !== id) return n;
    const out: Node = { ...n };
    if (p.title != null && p.title !== n.title) (touch(marks, id, 'title', n.title), (out.title = p.title));
    if (p.est !== undefined && (p.est ?? undefined) !== n.est) (touch(marks, id, 'est', n.est), (out.est = p.est ?? undefined));
    if (p.due !== undefined && (p.due ?? undefined) !== n.due) (touch(marks, id, 'due', n.due), (out.due = p.due ?? undefined));
    if (p.status && p.status !== n.status) (touch(marks, id, 'status', n.status), (out.status = p.status));
    if (p.today != null && p.today !== n.today) (touch(marks, id, 'today', n.today), (out.today = p.today), p.today && (out.later = undefined));
    return out;
  });
}

const subtreeOf = (nodes: Node[], id: string) => {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) (ids.add(n.id), (grew = true));
  }
  return ids;
};

/** replace the full list of sub-items of `parentId` (recursively where a spec gives `children`) */
function setSubs(nodes: Node[], marks: Marks, parentId: string, specs: SubSpec[]): Node[] {
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent) return nodes;
  const kids = nodes.filter((n) => n.parentId === parentId);
  const inNext = parent.today || kids.some((k) => k.today);
  const keep = new Set(specs.map((sp) => sp.id));
  const now = Date.now();

  // what goes, with everything beneath it (shown struck out until accepted)
  const gone = kids.filter((k) => !keep.has(k.id));
  for (const g of gone) for (const id of subtreeOf(nodes, g.id)) if (marks[id]?.kind !== 'add') marks[id] = { kind: 'remove', prev: {} };

  // the new sibling order: the specs, then what is being removed
  const order: Node[] = [];
  for (const sp of specs) {
    const ex = nodes.find((n) => n.id === sp.id);
    if (ex && !sp.isNew) {
      let n = { ...ex };
      if (n.parentId !== parentId) (touch(marks, n.id, 'parent', ex.parentId), (n.parentId = parentId)); // moved here from elsewhere
      if (sp.title != null && sp.title !== ex.title) (touch(marks, n.id, 'title', ex.title), (n.title = sp.title));
      if (sp.est !== undefined && (sp.est ?? undefined) !== ex.est) (touch(marks, n.id, 'est', ex.est), (n.est = sp.est ?? undefined));
      if (sp.status && sp.status !== ex.status) (touch(marks, n.id, 'status', ex.status), (n.status = sp.status));
      order.push(n);
    } else {
      marks[sp.id] = { kind: 'add', prev: {} };
      order.push({
        id: sp.id,
        parentId,
        title: sp.title?.trim() || 'Untitled',
        status: sp.status ?? 'todo',
        today: inNext,
        open: true,
        created: now,
        modified: now,
        est: sp.est ?? undefined,
      });
    }
  }
  order.push(...gone);

  // lay the subtrees out right after the parent, in that order
  const moving = new Set(order.map((n) => n.id));
  const blocks = order.map((n) => {
    const sub = subtreeOf(nodes, n.id);
    return [n, ...nodes.filter((x) => sub.has(x.id) && x.id !== n.id && !moving.has(x.id))];
  });
  const inBlock = new Set(blocks.flat().map((n) => n.id));
  const rest = nodes.filter((n) => !inBlock.has(n.id));
  const at = rest.findIndex((n) => n.id === parentId) + 1;
  let out = [...rest.slice(0, at), ...blocks.flat(), ...rest.slice(at)];
  if (!parent.open) out = out.map((n) => (n.id === parentId ? { ...n, open: true } : n));

  for (const sp of specs) if (sp.children) out = setSubs(out, marks, sp.id, sp.children);
  return out;
}

/** the document's items with the ops applied, and what each op touched */
export function applyOps(nodes: Node[], ops: AiOp[]): { nodes: Node[]; marks: Marks } {
  const marks: Marks = {};
  let out = nodes;
  for (const op of ops) {
    if (!out.some((n) => n.id === op.id)) continue; // gone since it was proposed
    out = op.op === 'patch' ? patchOne(out, marks, op.id, op.set) : setSubs(out, marks, op.id, op.items);
  }
  // a change that ends up equal to where it started is no change
  for (const [id, m] of Object.entries(marks)) {
    if (m.kind !== 'change') continue;
    const n = out.find((x) => x.id === id)!;
    for (const k of Object.keys(m.prev) as (PatchKey | 'parent')[]) if ((m.prev[k] ?? undefined) === ((k === 'parent' ? n.parentId : n[k]) ?? undefined)) delete m.prev[k];
    if (!Object.keys(m.prev).length) delete marks[id];
  }
  return { nodes: out, marks };
}

/** the state the views render: the document, or the document as the pending proposal would leave it */
export function viewOf(s: State): { s: State; marks: Marks | null } {
  if (!s.proposal?.ops.length) return { s, marks: null };
  const r = applyOps(s.nodes, s.proposal.ops);
  return { s: { ...s, nodes: r.nodes }, marks: r.marks };
}
export function useView() {
  const s = useS();
  const r = useMemo(() => (s.proposal?.ops.length ? applyOps(s.nodes, s.proposal.ops) : null), [s.nodes, s.proposal]);
  return r ? { s: { ...s, nodes: r.nodes }, marks: r.marks } : { s, marks: null as Marks | null };
}

export function countMarks(m: Marks) {
  const c = { add: 0, change: 0, remove: 0 };
  for (const v of Object.values(m)) c[v.kind]++;
  return c;
}
export function describe(m: Marks) {
  const c = countMarks(m);
  const parts = [c.add && `${c.add} new`, c.change && `${c.change} changed`, c.remove && `${c.remove} removed`].filter(Boolean);
  return parts.join(' · ') || 'no changes';
}

/* ---------- recording (from the AI tools) ---------- */
export function propose(op: AiOp) {
  set((s) => ({ proposal: { ops: [...(s.proposal?.ops ?? []), op] } }));
}
/** give every new sub-item an id now, so later ops (and the model) can refer to it */
export function mintIds(items: SubSpec[], exists: (id: string) => boolean): SubSpec[] {
  return items.map((it) => {
    const known = !!it.id && exists(it.id);
    return { ...it, id: known ? it.id : 'n' + uid(), isNew: !known || undefined, children: it.children ? mintIds(it.children, exists) : undefined };
  });
}

/* ---------- accept / reject ---------- */
export function acceptProposal(): string | null {
  const s = get();
  if (!s.proposal?.ops.length) return (set(() => ({ proposal: null })), null);
  const r = applyOps(s.nodes, s.proposal.ops);
  const summary = describe(r.marks);
  commit(`AI: ${summary}`, (st) => {
    const gone = new Set(Object.entries(r.marks).filter(([, m]) => m.kind === 'remove').map(([id]) => id));
    const nodes = r.nodes.filter((n) => !gone.has(n.id)).map((n) => (r.marks[n.id] ? { ...n, modified: Date.now() } : n));
    return { nodes, current: st.current && gone.has(st.current.id) ? null : st.current, proposal: null };
  });
  return summary;
}
export function rejectProposal() {
  set(() => ({ proposal: null }));
}
