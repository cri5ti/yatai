/**
 * "Edit as markdown" (⌘E): the same list format as copy / paste (clip.ts), edited as text, then applied back as a
 * *diff* against the items, not a re-creation. Items that are untouched keep their object (and so every field the
 * text does not carry: created, today, scheduled, spent, open, smart …); changed ones get just the changed fields;
 * only really new lines become new items, and only lines that are gone delete items.
 *
 * Matching old items to new lines (there are no ids in the text):
 *  1. identical lines, by a longest-common-subsequence over the list (so an inserted / removed block lines up);
 *  2. between those anchors, an edited line is the old item it most resembles (same words), or the only one there;
 *  3. what is left matches by identical title anywhere, so an item moved to another place keeps its identity.
 */
import { parseMarkdown, toMarkdown } from './clip';
import type { ClipItem } from './clip';
import type { Node, Status } from './store';
import { uid } from './store';

interface Entry {
  depth: number;
  parent: number; // index of the parent entry in the same list, -1 = the scope's own parent
  item: ClipItem;
  node?: Node; // old entries only
}

const flat = (items: ClipItem[], depth = 0, parent = -1, out: Entry[] = []): Entry[] => {
  for (const item of items) {
    const at = out.push({ depth, parent, item }) - 1;
    flat(item.kids, depth + 1, at, out);
  }
  return out;
};

const markOf = (it: ClipItem) => (it.done ? 'x' : it.dropped ? '-' : ' ');
/** everything the text says about a line, including how deep it is */
const lineKey = (e: Entry) => `${e.depth}|${markOf(e.item)}|${e.item.title}|${e.item.est ?? ''}|${e.item.due ?? ''}|${e.item.prio ?? ''}`;
const bodyKey = (e: Entry) => lineKey(e).slice(String(e.depth).length);

/** which items a ⌘E edits: what the view shows (Next: its rows and the tasks above them; Organizer: the whole tree), or just the selection with its sub-items */
export function scopeFor(nodes: Node[], view: 'next' | 'tree' | 'selection', picked: string[] = []): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const up = (n: Node, f: (x: Node) => void) => {
    for (let p = n.parentId ? byId.get(n.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) f(p);
  };
  const out = new Set<string>();
  if (view === 'next') {
    for (const n of nodes) if (n.today) (out.add(n.id), up(n, (p) => out.add(p.id)));
  } else if (view === 'tree') {
    // everything under a top-level item (items hanging off a meeting belong to Next, not to the tree)
    for (const n of nodes) {
      let top = n;
      up(n, (p) => (top = p));
      if (top.parentId === null) out.add(n.id);
    }
  } else {
    const sel = new Set(picked);
    for (const n of nodes) {
      if (sel.has(n.id)) out.add(n.id);
      else up(n, (p) => sel.has(p.id) && out.add(n.id));
    }
  }
  return nodes.filter((n) => out.has(n.id)).map((n) => n.id);
}

/** the scope as a forest: its items, children in document order (an item whose parent is not in the scope is a root) */
function forest(nodes: Node[], scope: Set<string>) {
  const kids = new Map<string | null, Node[]>();
  const roots: Node[] = [];
  for (const n of nodes) {
    if (!scope.has(n.id)) continue;
    if (n.parentId && scope.has(n.parentId)) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
    else roots.push(n);
  }
  return { roots, kids };
}

/** the text for these items */
export function exportScope(nodes: Node[], scope: string[], isDone: (id: string) => boolean): string {
  const { roots, kids } = forest(nodes, new Set(scope));
  const build = (n: Node): ClipItem => ({ title: n.title, done: isDone(n.id), dropped: n.status === 'dropped', est: n.est, due: n.due, prio: n.prio, kids: (kids.get(n.id) ?? []).map(build) });
  return toMarkdown(roots.map(build));
}

function oldEntries(nodes: Node[], scope: Set<string>, isDone: (id: string) => boolean): Entry[] {
  const { roots, kids } = forest(nodes, scope);
  const out: Entry[] = [];
  const walk = (n: Node, depth: number, parent: number) => {
    const item: ClipItem = { title: n.title, done: isDone(n.id), dropped: n.status === 'dropped', est: n.est, due: n.due, prio: n.prio, kids: [] };
    const at = out.push({ depth, parent, item, node: n }) - 1;
    for (const c of kids.get(n.id) ?? []) walk(c, depth + 1, at);
  };
  roots.forEach((n) => walk(n, 0, -1));
  return out;
}

const words = (t: string) => new Set(t.toLowerCase().split(/\s+/).filter(Boolean));
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 0.95;
  const A = words(a);
  const B = words(b);
  let both = 0;
  A.forEach((w) => B.has(w) && both++);
  const jac = both / (A.size + B.size - both || 1);
  return x.startsWith(y) || y.startsWith(x) ? Math.max(jac, 0.6) : jac;
}

/** which old entry (or -1) each new entry is */
function match(olds: Entry[], news: Entry[]): number[] {
  const n = news.length;
  const o = olds.length;
  const to = new Array<number>(n).fill(-1);
  const used = new Array<boolean>(o).fill(false);
  const take = (ni: number, oi: number) => ((to[ni] = oi), (used[oi] = true));
  const ok = olds.map(lineKey);
  const nk = news.map(lineKey);

  // 1. identical lines: common prefix / suffix, then an LCS of what is between
  let pre = 0;
  while (pre < Math.min(n, o) && ok[pre] === nk[pre]) take(pre, pre), pre++;
  let suf = 0;
  while (suf < Math.min(n, o) - pre && ok[o - 1 - suf] === nk[n - 1 - suf]) take(n - 1 - suf, o - 1 - suf), suf++;
  const om = o - pre - suf;
  const nm = n - pre - suf;
  if (om > 0 && nm > 0 && om * nm <= 4_000_000) {
    const w = nm + 1;
    const L = new Uint16Array((om + 1) * w);
    for (let i = om - 1; i >= 0; i--)
      for (let j = nm - 1; j >= 0; j--) L[i * w + j] = ok[pre + i] === nk[pre + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    for (let i = 0, j = 0; i < om && j < nm; ) {
      if (ok[pre + i] === nk[pre + j]) take(pre + j++, pre + i++);
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++;
      else j++;
    }
  }

  // 2. in each gap between matched lines, an edited line is the old line it resembles (or the only one there)
  const anchors: [number, number][] = [[-1, -1]];
  to.forEach((oi, ni) => oi >= 0 && anchors.push([oi, ni]));
  anchors.push([o, n]);
  for (let a = 0; a + 1 < anchors.length; a++) {
    const [o0, n0] = anchors[a];
    const [o1, n1] = anchors[a + 1];
    if (o1 - o0 === 2 && n1 - n0 === 2) {
      take(n0 + 1, o0 + 1); // one line replaced by one line: an edit
      continue;
    }
    let p = o0 + 1;
    for (let ni = n0 + 1; ni < n1; ni++) {
      let best = -1;
      let score = 0.5;
      for (let oi = p; oi < o1; oi++) {
        const sc = similarity(olds[oi].item.title, news[ni].item.title);
        if (sc > score) (best = oi), (score = sc);
      }
      if (best >= 0) (take(ni, best), (p = best + 1));
    }
  }

  // 3. identical titles anywhere: an item that moved
  const free = new Map<string, number[]>();
  olds.forEach((e, oi) => !used[oi] && free.set(e.item.title, [...(free.get(e.item.title) ?? []), oi]));
  to.forEach((oi, ni) => {
    if (oi >= 0) return;
    const hit = free.get(news[ni].item.title)?.shift();
    if (hit != null) take(ni, hit);
  });
  return to;
}

export interface EditStats {
  added: number;
  removed: number; // deleted items, sub-items that were not in the text included
  changed: number; // text, estimate, due date or done / dropped changed
  moved: number; // under another parent, or at another depth
}
export interface EditPlan {
  nodes: Node[]; // the whole item list after the edit
  stats: EditStats;
  same: boolean;
  /** items whose done / dropped state changed (for the running timer) */
  restated: string[];
  removedIds: string[];
}

/**
 * What the items become when the text of `scope` (see scopeFor) is replaced by `text`. Everything outside the scope stays
 * as it is (an item deleted from the text takes its sub-items with it, seen or not). `today`: new items are put in Next.
 */
export function planEdit(nodes: Node[], scope: string[], text: string, isDone: (id: string) => boolean, today = false, mint: () => string = uid, now = Date.now()): EditPlan {
  const inScope = new Set(scope);
  const olds = oldEntries(nodes, inScope, isDone);
  const news = flat(parseMarkdown(text));
  const to = match(olds, news);
  const stats: EditStats = { added: 0, removed: 0, changed: 0, moved: 0 };
  const restated: string[] = [];

  // where a top-level line goes: the parent it had if it was already a top-level one, else the parent all of them share
  const rootParents = new Set(olds.filter((e) => e.parent < 0).map((e) => e.node!.parentId));
  const common = rootParents.size === 1 ? [...rootParents][0] : null;

  const ids = news.map((_, i) => (to[i] >= 0 ? olds[to[i]].node!.id : mint()));
  const made = news.map((e, i): Node => {
    const old = to[i] >= 0 ? olds[to[i]] : null;
    const parent = e.parent >= 0 ? ids[e.parent] : old && old.parent < 0 ? old.node!.parentId : common;
    const it = e.item;
    if (!old) {
      stats.added++;
      const status: Status = it.done ? 'done' : it.dropped ? 'dropped' : 'todo';
      return { id: ids[i], parentId: parent, title: it.title, status, today, open: true, created: now, modified: now, ...(it.est ? { est: it.est } : {}), ...(it.due ? { due: it.due } : {}), ...(it.prio ? { prio: it.prio } : {}) };
    }
    const n = old.node!;
    const textSame = bodyKey(e) === bodyKey(old);
    const markSame = markOf(it) === markOf(old.item);
    if (textSame && n.parentId === parent) return n;
    if (!textSame) stats.changed++;
    if (n.parentId !== parent) stats.moved++;
    let status = n.status;
    if (!markSame) {
      status = it.done ? 'done' : it.dropped ? 'dropped' : 'todo';
      restated.push(n.id);
    }
    const next: Node = { ...n, parentId: parent, title: it.title, status, modified: now };
    if (it.est) next.est = it.est;
    else delete next.est;
    if (it.due) next.due = it.due;
    else delete next.due;
    if (it.prio) next.prio = it.prio;
    else delete next.prio;
    return next;
  });
  // a parent that gained a child opens up
  const opened = new Set(news.flatMap((e, i) => (to[i] < 0 && e.parent >= 0 ? [ids[e.parent]] : [])));
  const out = made.map((n) => (opened.has(n.id) && !n.open ? { ...n, open: true } : n));

  // lines that are gone delete their items, and whatever hangs below them outside the text
  const kept = new Set(ids);
  const kill = new Set(olds.filter((e) => !kept.has(e.node!.id)).map((e) => e.node!.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of nodes) if (!kill.has(n.id) && !kept.has(n.id) && n.parentId && kill.has(n.parentId)) (kill.add(n.id), (grew = true));
  }
  stats.removed = kill.size;

  // every untouched item stays where it is; the others go right after the line above them (same parent), or before the one below
  const byNew = new Map(out.map((n) => [n.id, n]));
  let arr = nodes.filter((n) => !kill.has(n.id)).map((n) => byNew.get(n.id) ?? n);
  const oldPrev = new Map<string, string | null>(); // previous in-scope sibling before the edit
  const lastOf = new Map<string | null, string>();
  for (const n of nodes) {
    if (!inScope.has(n.id)) continue;
    oldPrev.set(n.id, lastOf.get(n.parentId) ?? null);
    lastOf.set(n.parentId, n.id);
  }
  const oldParent = new Map(nodes.map((n) => [n.id, n.parentId]));
  const sibling = (i: number, dir: 1 | -1) => {
    for (let j = i + dir; j >= 0 && j < news.length; j += dir) if (news[j].parent === news[i].parent && news[j].depth === news[i].depth && (news[i].parent >= 0 || byNew.get(ids[j])!.parentId === byNew.get(ids[i])!.parentId)) return j;
    return -1;
  };
  const hasOld = new Set(nodes.map((n) => n.id));
  const block = (a: Node[], id: string) => {
    const set = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const n of a) if (n.parentId && set.has(n.parentId) && !set.has(n.id)) (set.add(n.id), (grew = true));
    }
    return set;
  };
  const endOf = (a: Node[], id: string) => {
    const b = block(a, id);
    let k = -1;
    a.forEach((n, i) => b.has(n.id) && (k = i));
    return k;
  };
  const stays: boolean[] = [];
  news.forEach((_, i) => {
    const id = ids[i];
    const node = byNew.get(id)!;
    const pj = sibling(i, -1);
    const nj = sibling(i, 1);
    const p = pj >= 0 ? ids[pj] : null;
    stays[i] = hasOld.has(id) && oldParent.get(id) === node.parentId && (oldPrev.get(id) ?? null) === p && (pj < 0 || stays[pj]);
    if (stays[i]) return;
    let moving: Node[] = [node];
    if (hasOld.has(id)) {
      const b = block(arr, id);
      moving = arr.filter((n) => b.has(n.id));
      arr = arr.filter((n) => !b.has(n.id));
    }
    let at: number;
    if (p) at = endOf(arr, p) + 1;
    else if (nj >= 0 && arr.some((n) => n.id === ids[nj])) at = arr.findIndex((n) => n.id === ids[nj]);
    else if (node.parentId && arr.some((n) => n.id === node.parentId)) at = endOf(arr, node.parentId) + 1;
    else at = arr.length;
    arr.splice(at, 0, ...moving);
  });

  const same = arr.length === nodes.length && arr.every((n, i) => n === nodes[i]);
  return { nodes: arr, stats, same, restated, removedIds: [...kill] };
}
