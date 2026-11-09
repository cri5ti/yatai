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
import { parseMarkdown, toMarkdown, treeOf } from './clip';
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
const lineKey = (e: Entry) => `${e.depth}|${markOf(e.item)}|${e.item.title}|${e.item.est ?? ''}|${e.item.due ?? ''}`;
const bodyKey = (e: Entry) => lineKey(e).slice(String(e.depth).length);

/** the roots a ⌘E on `ids` edits: the selected items when they are consecutive siblings, none selected = the whole tree; null = not editable together */
export function scopeRoots(nodes: Node[], ids: string[]): string[] | null {
  const sel = new Set(ids);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const covered = (n: Node) => {
    for (let p = n.parentId ? byId.get(n.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) if (sel.has(p.id)) return true;
    return false;
  };
  const tops = nodes.filter((n) => sel.has(n.id) && !covered(n));
  if (!tops.length) return nodes.filter((n) => n.parentId === null).map((n) => n.id);
  const parent = tops[0].parentId;
  if (tops.some((n) => n.parentId !== parent)) return null;
  const sibs = nodes.filter((n) => n.parentId === parent);
  const first = sibs.findIndex((n) => n.id === tops[0].id);
  return tops.every((n, i) => sibs[first + i]?.id === n.id) ? tops.map((n) => n.id) : null;
}

/** the text for these roots */
export function exportScope(nodes: Node[], roots: string[], isDone: (id: string) => boolean): string {
  return toMarkdown(treeOf(nodes, roots, isDone));
}

function oldEntries(nodes: Node[], roots: string[], isDone: (id: string) => boolean): Entry[] {
  const kids = new Map<string | null, Node[]>();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const out: Entry[] = [];
  const walk = (n: Node, depth: number, parent: number) => {
    const item: ClipItem = { title: n.title, done: isDone(n.id), dropped: n.status === 'dropped', est: n.est, due: n.due, kids: [] };
    const at = out.push({ depth, parent, item, node: n }) - 1;
    for (const c of kids.get(n.id) ?? []) walk(c, depth + 1, at);
  };
  const want = new Set(roots);
  nodes.filter((n) => want.has(n.id)).forEach((n) => walk(n, 0, -1));
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
  removed: number;
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
 * What the items become when the text of `roots` (see scopeRoots) is replaced by `text`.
 * `parentId` is where the roots hang (null = top level).
 */
export function planEdit(nodes: Node[], roots: string[], text: string, isDone: (id: string) => boolean, mint: () => string = uid, now = Date.now()): EditPlan {
  const parentId = nodes.find((n) => n.id === roots[0])?.parentId ?? null;
  const olds = oldEntries(nodes, roots, isDone);
  const news = flat(parseMarkdown(text));
  const to = match(olds, news);
  const stats: EditStats = { added: 0, removed: 0, changed: 0, moved: 0 };
  const restated: string[] = [];

  const ids = news.map((_, i) => (to[i] >= 0 ? olds[to[i]].node!.id : mint()));
  const made = news.map((e, i): Node => {
    const parent = e.parent >= 0 ? ids[e.parent] : parentId;
    const old = to[i] >= 0 ? olds[to[i]] : null;
    const it = e.item;
    if (!old) {
      stats.added++;
      const status: Status = it.done ? 'done' : it.dropped ? 'dropped' : 'todo';
      return { id: ids[i], parentId: parent, title: it.title, status, today: false, open: true, created: now, modified: now, ...(it.est ? { est: it.est } : {}), ...(it.due ? { due: it.due } : {}) };
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
    return next;
  });
  // a parent that gained a child opens up
  const opened = new Set(news.flatMap((e, i) => (to[i] < 0 && e.parent >= 0 ? [ids[e.parent]] : [])));
  const out = made.map((n) => (opened.has(n.id) && !n.open ? { ...n, open: true } : n));

  const kept = new Set(ids);
  const removedIds = olds.filter((e) => !kept.has(e.node!.id)).map((e) => e.node!.id);
  stats.removed = removedIds.length;

  // put the result where the first old item was, the rest of the document untouched
  const scope = new Set(olds.map((e) => e.node!.id));
  const rest = nodes.filter((n) => !scope.has(n.id));
  const first = nodes.findIndex((n) => scope.has(n.id));
  const at = first < 0 ? rest.length : nodes.slice(0, first).filter((n) => !scope.has(n.id)).length;
  rest.splice(at, 0, ...out);

  const same = rest.length === nodes.length && rest.every((n, i) => n === nodes[i]);
  return { nodes: rest, stats, same, restated, removedIds };
}
