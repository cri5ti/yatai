import type { BuildStatus, Meeting, Node, Nsel, PrStatus, Seg, State } from './store';
import type { AgendaEvent, Alert, Snapshot } from './plugins/types';

export const FX = 'fx_'; // fixed calendar row inside a meeting card: fx_<meetingId>

export const fmt = (m: number) => {
  m = Math.round(m);
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const relTime = (ms: number) => {
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
};

export const fmtEst = (m?: number) => (m ? (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`) : '');

export const fmtSpent = (ms: number) => {
  const t = Math.floor(ms / 1000);
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
export function dueLabel(due: string): { text: string; tone: 'bad' | 'warn' | 'info' } {
  const days = Math.round((Date.parse(due) - Date.parse(isoDay(0))) / 86_400_000);
  if (days < 0) return { text: 'overdue', tone: 'bad' };
  if (days === 0) return { text: 'due today', tone: 'warn' };
  if (days === 1) return { text: 'due tomorrow', tone: 'info' };
  return { text: `due in ${days}d`, tone: 'info' };
}
export const laterLabel = (d?: number) => (d == null ? '' : d === 1 ? 'tomorrow' : `in ${d}d`);

/* ---------- GitHub pull-request links ---------- */
/** the one GitHub host whose links are recognised: github.com, or the Enterprise host from Settings */
let prHost = 'github.com';
export const normHost = (h: string) => h.trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').toLowerCase() || 'github.com';
export const setPrHost = (h: string) => void (prHost = normHost(h));
export const getPrHost = () => prHost;
const prSrc = () => `https://${prHost.replace(/\./g, '\\.')}/([\\w.-]+)/([\\w.-]+)/pulls?/(\\d+)`;
export interface PrLink {
  key: string; // org/repo#123
  org: string;
  repo: string;
  num: string;
  url: string;
}
/** every PR link in a piece of text (a url, with or without trailing path) */
export function prLinks(text: string): PrLink[] {
  const re = new RegExp(prSrc() + '(?:[/?#][^\\s)]*)?', 'g');
  const out: PrLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (!notThePr(m[0])) out.push({ key: `${m[1]}/${m[2]}#${m[3]}`, org: m[1], repo: m[2], num: m[3], url: m[0] });
  return out;
}
/** a link into a PR's conversation (a review comment, a review) points at a comment, not at the PR */
const notThePr = (url: string) => /#(discussion_r|issuecomment-|pullrequestreview-)/.test(url);
export const prMatch = (url: string) => (notThePr(url) ? null : new RegExp('^' + prSrc()).exec(url));
export const prUrl = (org: string, repo: string, num: string) => `https://${prHost}/${org}/${repo}/pull/${num}`;
/** text for places that cannot render a link: PR urls become repo#123 */
export const plain = (text: string) => text.replace(new RegExp(prSrc() + '(?:[/?#][^\\s)]*)?', 'g'), (_, _o, r, n) => `${r}#${n}`);

/* ---------- Azure DevOps pipeline run (build) links ---------- */
/** …/_build/results?buildId=123 on dev.azure.com/<org>/<project> or <org>.visualstudio.com/<project> */
const BUILD_SRC = 'https:\\/\\/((?:dev\\.azure\\.com\\/[\\w.-]+|[\\w-]+\\.visualstudio\\.com)\\/([^\\s/?#]+))\\/_build\\/results\\?(?:[^\\s#]*?&)?buildId=(\\d+)';
export interface BuildLink {
  key: string; // dev.azure.com/acme/Payroll#4211
  base: string; // dev.azure.com/acme/Payroll
  project: string;
  id: string;
  url: string;
}
export function buildLinks(text: string): BuildLink[] {
  const re = new RegExp(BUILD_SRC + '[^\\s)]*', 'g');
  const out: BuildLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ key: `${m[1]}#${m[3]}`, base: m[1], project: decodeURIComponent(m[2]), id: m[3], url: m[0] });
  return out;
}
export const buildMatch = (url: string) => buildLinks(url).find((l) => l.url === url) ?? null;
export const buildUrl = (base: string, id: string) => `https://${base}/_build/results?buildId=${id}`;
const BUILD_STATES: BuildStatus[] = ['queued', 'building', 'failed', 'done', 'cancelled'];
/** a run's state as the DevOps plugin last reported it; null when it has not (not tracked, not connected, can't see it) */
export const buildStatusOf = (snaps: Record<string, Snapshot>, ref: string): BuildStatus | null => {
  const sn = snaps[ref];
  return sn && !sn.gone && BUILD_STATES.includes(sn.view.glyph as BuildStatus) ? (sn.view.glyph as BuildStatus) : null;
};

/* ---------- plugin refs and their snapshots ---------- */
/** the ref an item's `smart` badge tracks; items made before refs existed derive it */
export function smartRef(n: Node): string | undefined {
  if (!n.smart) return undefined;
  if (n.smart.ref) return n.smart.ref;
  switch (n.smart.source) {
    case 'pipeline': return 'devops:run/deploy-2.4';
    case 'workitem': return `devops:wi/${/WI (\d+)/.exec(n.title)?.[1] ?? '0'}`;
    case 'ai': return 'ai:session/claude';
  }
  return undefined;
}
/** everything an item tracks: its smart ref and the PR links on its first line */
export function refsOf(n: Node): string[] {
  const out = new Set<string>();
  const r = smartRef(n);
  if (r) out.add(r);
  const first = n.title.split('\n')[0];
  for (const l of prLinks(first)) out.add(`github:${l.key}`);
  for (const l of buildLinks(first)) out.add(`devops:build/${l.key}`);
  return [...out];
}
type Snaps = Record<string, Snapshot>;
/** a PR's state as the GitHub plugin last reported it ('review' until it has) */
/** a PR's state as the GitHub plugin last reported it; null when it has not (never guessed: see NoState in Pr.tsx) */
export const prStatusOf = (snaps: Snaps, key: string): PrStatus | null => {
  const sn = snaps[`github:${key}`];
  return sn && !sn.gone ? (sn.view.glyph as PrStatus) : null;
};
export const prCountOf = (snaps: Snaps, key: string): number | undefined => snaps[`github:${key}`]?.view.count;
/** whose move it is on a PR (unset: not known, or it is over) */
export const prTurnOf = (snaps: Snaps, key: string) => {
  const sn = snaps[`github:${key}`];
  return sn && !sn.gone ? sn.view.turn : undefined;
};

/** PR states that want your attention (like a smart item with a non-neutral alert) */
export const PR_ATTENTION: PrStatus[] = ['failing', 'feedback', 'ready'];
export function prAttention(n: Node, snaps: Snaps) {
  if (n.status === 'done') return false;
  return prLinks(n.title.split('\n')[0]).some((l) => {
    const st = prStatusOf(snaps, l.key);
    return !!st && PR_ATTENTION.includes(st) && prTurnOf(snaps, l.key) !== 'them'; // waiting on others is not for me
  });
}

/** does any item in the subtree of `id` carry a highlight? (used so a collapsed parent can show it) */
export function anyHl(nodes: Node[], id: string, hl: Record<string, true>) {
  if (!Object.keys(hl).length) return false;
  const ids = new Set([id]);
  for (const n of nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
  return nodes.some((n) => ids.has(n.id) && n.id !== id && hl[n.id]);
}

/** highlighted items in the subtree of `id` (including itself) */
export function hlSubtree(nodes: Node[], hl: Record<string, true>, id: string): string[] {
  if (!Object.keys(hl).length) return [];
  const ids = new Set([id]);
  for (const n of nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
  return nodes.filter((n) => ids.has(n.id) && hl[n.id]).map((n) => n.id);
}
/**
 * Where each yellow highlight shows in Next: on its own row when that is visible, else on the first visible thing above
 * it: a row (its parent collapsed, or not in Next itself), or the card's header when the card is collapsed (or the item
 * hangs under a meeting / the card's item). Keys: `row:<row id>` and `card:<card key>`; values: the highlighted ids that
 * show there, which is also what hovering it clears. A highlight with nothing of it in Next shows nowhere here.
 */
export function hlTargets(cards: CardM[], nodes: Node[], hl: Record<string, true>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!Object.keys(hl).length) return out;
  const vis = new Map<string, string>(); // node (or meeting) id -> where it is seen
  const see = (id: string, at: string) => !vis.has(id) && vis.set(id, at);
  for (const c of cards) {
    const card = `card:${c.key}`;
    if (c.collapsed) {
      see(c.ownerId, card);
      for (const r of c.rows) if (r.node) see(r.node.id, card);
      continue;
    }
    let hideBelow = Infinity; // rows deeper than a collapsed row are hidden
    for (const r of c.rows) {
      if (r.depth > hideBelow) continue;
      hideBelow = Infinity;
      if (!r.node) continue;
      see(r.node.id, `row:${r.id}`);
      if (r.kids && r.node.open === false) hideBelow = r.depth;
    }
    see(c.ownerId, card); // the card's item (when it is not a row of its own) or its meeting
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const id of Object.keys(hl)) {
    let cur: string | null | undefined = id;
    for (let guard = 0; cur && guard < 64; guard++) {
      const at = vis.get(cur);
      if (at) {
        out.set(at, [...(out.get(at) ?? []), id]);
        break;
      }
      cur = byId.get(cur)?.parentId;
    }
  }
  return out;
}

/** the priority a row shows: its own, or — when collapsed — the highest (lowest number) in its subtree */
export function prioShown(nodes: Node[], id: string, collapsed: boolean): { p: number; inside: boolean } | null {
  const own = nodes.find((n) => n.id === id)?.prio;
  if (!collapsed) return own ? { p: own, inside: false } : null;
  const ids = new Set([id]);
  let best = own ?? 99;
  for (const n of nodes) if (n.parentId && ids.has(n.parentId)) (ids.add(n.id), n.prio && n.status === 'todo' && n.prio < best && (best = n.prio));
  return best > 5 ? null : { p: best, inside: best !== own };
}

/** the priority filter: items of priority 1…`p` and every parent above them */
export function prioKeep(nodes: Node[], p: number): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keep = new Set<string>();
  for (const n of nodes) {
    if (!n.prio || n.prio > p) continue;
    for (let cur: Node | undefined = n; cur && !keep.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) keep.add(cur.id);
  }
  return keep;
}
/** Next under the priority filter: everything unfolded, then only the kept rows (cards left empty go) */
export function filterNext(s: Parameters<typeof nextModel>[0], p: number) {
  const keep = prioKeep(s.nodes, p);
  const m = nextModel({ ...s, nodes: s.nodes.map((n) => (n.open === false ? { ...n, open: true } : n)) });
  const cards = m.cards.flatMap((c) => {
    const rows = c.rows.filter((r) => r.node && keep.has(r.node.id));
    if (!rows.length) return [];
    return [{ ...c, collapsed: false, rows: rows.map((r, i) => ({ ...r, kids: (rows[i + 1]?.depth ?? -1) > r.depth })) }];
  });
  return { ...m, cards };
}

/** can this item be brought into Next from under a row? (open, and not in Next already) */
export const bringable = (n: Node) => !n.today && n.status !== 'done' && n.status !== 'dropped';
/** per item: how many items below it are not in Next (the count pill on a row of Next) */
export function outOfNext(nodes: Node[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, number>();
  for (const n of nodes) {
    if (!bringable(n)) continue;
    for (let cur = n.parentId ? byId.get(n.parentId) : undefined, i = 0; cur && i < 100; cur = cur.parentId ? byId.get(cur.parentId) : undefined, i++) out.set(cur.id, (out.get(cur.id) ?? 0) + 1);
  }
  return out;
}

/** the highest of several shown priorities (a collapsed card) */
export const bestPrio = (vs: ({ p: number; inside: boolean } | null)[]) =>
  vs.reduce<{ p: number; inside: boolean } | null>((b, v) => (v && (!b || v.p < b.p) ? { p: v.p, inside: true } : b), null);

export const childrenOf = (nodes: Node[], id: string | null) => nodes.filter((n) => n.parentId === id);

export function pathOf(nodes: Node[], id: string | null): string[] {
  const out: string[] = [];
  let cur = id;
  while (cur) {
    const n = nodes.find((x) => x.id === cur);
    if (!n) break;
    out.unshift(plain(n.title.split('\n')[0]));
    cur = n.parentId;
  }
  return out;
}

/** the chips of a smart item: what its plugin last said (nothing until it has said something) */
export function alertsFor(n: Node, snaps: Snaps): Alert[] {
  const ref = smartRef(n);
  if (!ref || n.status === 'done') return [];
  return snaps[ref]?.alerts ?? [];
}

export const needsAttention = (n: Node, snaps: Snaps) => alertsFor(n, snaps).some((a) => a.tone !== 'info');

/* ---------- meetings ---------- */
export interface EffMeeting extends Meeting {
  eff: number;
  movedFrom?: number;
  dayOffset: number; // 0 = today, 1 = tomorrow … (a meeting brought in ahead, to prepare)
  minsAway: number;
  state: 'upcoming' | 'now' | 'done';
}

/** 'Tue 09:30' for a meeting ahead, '09:30' for today's */
export const whenLabel = (m: Pick<EffMeeting, 'eff' | 'dayOffset' | 'day'>) =>
  m.dayOffset > 0 && m.day ? `${new Date(m.day + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' })} ${fmt(m.eff)}` : fmt(m.eff);
export const inLabel = (m: Pick<EffMeeting, 'minsAway' | 'dayOffset' | 'day'>) =>
  m.dayOffset === 1 ? 'tomorrow' : m.dayOffset > 1 ? `in ${m.dayOffset} days` : `in ${Math.ceil(m.minsAway)} min`;

export const allAgenda = (s: Pick<State, 'agenda'>): AgendaEvent[] => Object.values(s.agenda).flat();

/** am I in a meeting right now? (one in Next, or anything on today's calendar) */
export const inMeeting = (s: Pick<State, 'agenda' | 'meetings' | 'clock' | 'day'>) =>
  meetingsFor(s).some((m) => m.state === 'now' && m.dayOffset === 0) ||
  allAgenda(s).some((e) => !e.cancelled && (e.day ?? s.day) === s.day && e.start <= s.clock && s.clock < e.start + e.durationMin);

/** the tray icon: changes to look at beat being in a meeting */
export const trayMode = (s: Pick<State, 'agenda' | 'meetings' | 'clock' | 'day' | 'hl'>): 'normal' | 'attention' | 'meeting' =>
  Object.keys(s.hl).length ? 'attention' : inMeeting(s) ? 'meeting' : 'normal';

/** the meetings in Next; `movedTo` is where the calendar moved one (the tracker sets it when the agenda changes) */
export function meetingsFor(s: Pick<State, 'meetings' | 'clock' | 'day'>): EffMeeting[] {
  return s.meetings
    .map((m) => {
      const moved = m.movedTo != null && m.movedTo !== m.start;
      const eff = moved ? m.movedTo! : m.start;
      const dayOffset = Math.max(0, Math.round((Date.parse(m.day ?? s.day) - Date.parse(s.day)) / 86_400_000) || 0);
      const minsAway = dayOffset * 1440 + eff - s.clock;
      const state: EffMeeting['state'] = minsAway > 0 ? 'upcoming' : minsAway + m.durationMin > 0 ? 'now' : 'done';
      return { ...m, eff, movedFrom: moved ? m.start : undefined, dayOffset, minsAway, state };
    })
    .sort((a, b) => a.dayOffset - b.dayOffset || a.eff - b.eff);
}

/* ---------- items: everything is an item; "task" just means "has children" ---------- */
export const ROOT = '~'; // owner of Next rows whose item has no parent

export const kidsOf = (nodes: Node[], id: string) => nodes.filter((n) => n.parentId === id);
export const hasKids = (nodes: Node[], id: string) => nodes.some((n) => n.parentId === id);
export function subtreeOf(nodes: Node[], id: string): Node[] {
  const ids = new Set([id]);
  const out: Node[] = [];
  for (const n of nodes) {
    if (n.id === id || (n.parentId && ids.has(n.parentId))) (ids.add(n.id), out.push(n));
  }
  return out;
}
export const leavesOf = (nodes: Node[], id: string): Node[] => {
  const sub = subtreeOf(nodes, id);
  return sub.filter((n) => !sub.some((c) => c.parentId === n.id));
};
export const depthOf = (nodes: Node[], id: string) => {
  let d = 0;
  let cur = nodes.find((n) => n.id === id)?.parentId ?? null;
  while (cur) {
    const p = nodes.find((n) => n.id === cur);
    if (!p) break;
    d++;
    cur = p.parentId;
  }
  return d;
};

/* ---------- the plan: ordered segments shown as cards in Next ---------- */

/**
 * Bring the stored plan in line with the items: drop rows that are gone / no longer in Next,
 * add newly planned rows to their owner's last segment (or a new one), make sure every meeting
 * has its fixed row, and prune empty segments. Pure — callers persist the result when they commit.
 *
 * A "row" is an item flagged for Next whose parent is not itself a Next row; its owner (card header) is its parent.
 * Next rows under a Next row simply nest beneath it and are not listed in seg.items.
 */
export function reconcilePlan(plan: Seg[], nodes: Node[], meetings: Meeting[]): Seg[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const mIds = new Set(meetings.map((m) => m.id));
  const isOwner = (id: string) => id === ROOT || mIds.has(id) || byId.has(id);
  const ownerOf = (n: Node) => n.parentId ?? ROOT;
  const isRootRow = (n: Node) => n.today && !(n.parentId && byId.get(n.parentId)?.today);
  /** a sub-item of a Next row normally nests under it; a "pulled" segment lists it on its own, the parent repeating as header */
  const valid = (sg: Seg, id: string) => {
    if (id.startsWith(FX)) return id === FX + sg.owner && mIds.has(sg.owner);
    const n = byId.get(id);
    return !!n && n.today && ownerOf(n) === sg.owner && (isRootRow(n) || !!sg.pulled);
  };

  const seen = new Set<string>();
  const segs: Seg[] = [];
  for (const sg of plan) {
    if (!isOwner(sg.owner)) continue;
    const items = sg.items.filter((id) => {
      if (!valid(sg, id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    segs.push({ ...sg, items });
  }

  const lastSegOf = (owner: string) => {
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].owner === owner) return segs[i];
    return null;
  };
  const place = (owner: string, id: string) => {
    const sg = lastSegOf(owner);
    // top-level items are never grouped: each one is its own (header-less) card
    if (sg && owner !== ROOT) sg.items.push(id);
    else segs.push({ id: 's_' + owner, owner, items: [id] });
  };

  for (const n of nodes) {
    if (isRootRow(n) && !seen.has(n.id) && isOwner(ownerOf(n))) {
      seen.add(n.id);
      place(ownerOf(n), n.id);
    }
  }
  // meetings always carry their fixed calendar row
  for (const m of [...meetings].sort((a, b) => a.start - b.start)) {
    if (!seen.has(FX + m.id)) {
      seen.add(FX + m.id);
      place(m.id, FX + m.id);
    }
  }

  // top-level rows: one card each (a stored card holding several is split in place, keeping the order)
  for (let i = 0; i < segs.length; i++) {
    const sg = segs[i];
    if (sg.owner !== ROOT || sg.items.length < 2) continue;
    segs.splice(i, 1, ...sg.items.map((id, k) => (k === 0 ? { ...sg, items: [id] } : { id: 's_' + id, owner: ROOT, items: [id] })));
  }

  // prune empties: an owner keeps one empty segment only if it was created on purpose and has nothing else
  const hasItems = new Set(segs.filter((sg) => sg.items.length).map((sg) => sg.owner));
  const keptEmpty = new Set<string>();
  return segs.filter((sg) => {
    if (sg.items.length) return true;
    if (hasItems.has(sg.owner) || keptEmpty.has(sg.owner)) return false;
    if (sg.keep && byId.has(sg.owner)) {
      keptEmpty.add(sg.owner);
      return true;
    }
    return false;
  });
}

export interface Row {
  id: string;
  node?: Node;
  fx?: EffMeeting;
  depth: number; // 0 = the card's top row
  kids: boolean; // has Next children nested below it
  /** the item a card is about when it is not in Next itself (its Next children are): it shows as the card's first row, like any other */
  head?: true;
}

export interface CardM {
  key: string; // seg id, or att_<item id>
  kind: 'task' | 'meeting' | 'attention';
  seg?: Seg;
  ownerId: string;
  task?: Node; // the owner item (card header)
  meeting?: EffMeeting;
  path: string[];
  rows: Row[]; // flat, in display order, nested rows included
  part?: { i: number; n: number }; // split marker: shown on i > 1
  pinned: boolean; // by time (meetings) or by alert (attention): not user-orderable
  collapsed: boolean;
  est: number;
  done: number;
  total: number;
  allDone: boolean; // header check
}

const isCounted = (n: Node) => n.status !== 'dropped';

export function nextModel(s: Pick<State, 'nodes' | 'plan' | 'meetings' | 'clock' | 'day' | 'snaps'>) {
  const { nodes, snaps } = s;
  const plan = reconcilePlan(s.plan, nodes, s.meetings);
  const ms = new Map(meetingsFor(s).map((m) => [m.id, m]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const regular: CardM[] = [];
  const pinned: CardM[] = [];
  const attention: CardM[] = [];

  const stats = (rows: Row[], owner?: Node) => {
    const live = rows.filter((r) => r.node && isCounted(r.node));
    const done = live.filter((r) => r.node!.status === 'done').length;
    const empty = live.length === 0;
    return {
      est: live.reduce((a, r) => a + (r.node!.status === 'done' ? 0 : r.node!.est ?? 0), 0),
      done,
      total: live.length,
      allDone: owner?.status === 'done', // marked on the item itself: finishing what is inside never completes it
    };
  };

  // sub-items pulled out into a card of their own are not repeated under their parent
  const listed = new Set(plan.flatMap((sg) => sg.items));
  /** a root row followed by its Next descendants, depth-first in tree order */
  const expand = (n: Node, depth: number, out: Row[]) => {
    const kids = nodes.filter((c) => c.parentId === n.id && c.today && !listed.has(c.id));
    out.push({ id: n.id, node: n, depth, kids: kids.length > 0 });
    if (n.open !== false) for (const c of kids) expand(c, depth + 1, out);
  };

  for (const seg of plan) {
    const meeting = ms.get(seg.owner);
    const owner = byId.get(seg.owner);
    const rows: Row[] = [];
    let promoted = 0;
    for (const id of seg.items) {
      if (id.startsWith(FX)) {
        if (meeting) rows.push({ id, fx: meeting, depth: 0, kids: false });
        continue;
      }
      const n = byId.get(id)!;
      if ((n.smart && n.status !== 'done' && needsAttention(n, snaps))) {
        const arows: Row[] = [{ id: n.id, node: n, depth: 0, kids: false }];
        attention.push({
          key: 'att_' + n.id,
          kind: 'attention',
          ownerId: n.parentId ?? ROOT,
          task: byId.get(n.parentId ?? ''),
          path: pathOf(nodes, n.parentId),
          rows: arows,
          pinned: true,
          collapsed: false,
          ...stats(arows),
        });
        promoted++;
        continue;
      }
      expand(n, 0, rows);
    }
    if (meeting) {
      const userOpen = rows.some((r) => r.node && r.node.status !== 'done' && r.node.status !== 'dropped');
      if (meeting.state === 'done' && !userOpen) continue;
      const card: CardM = {
        key: seg.id,
        kind: 'meeting',
        seg,
        ownerId: meeting.id,
        meeting,
        path: [meeting.title],
        rows,
        pinned: meeting.state !== 'done' && (meeting.state === 'now' || meeting.minsAway <= 30),
        collapsed: meeting.open === false,
        ...stats(rows),
      };
      (card.pinned ? pinned : regular).push(card);
    } else if (owner || seg.owner === ROOT) {
      if (!rows.length && promoted) continue;
      // no card headers for items: the owner is the first row and what is in Next nests under it
      const shown: Row[] = owner
        ? [{ id: owner.id, node: owner, depth: 0, kids: rows.length > 0, head: true }, ...(owner.open === false ? [] : rows.map((r) => ({ ...r, depth: r.depth + 1 })))]
        : rows;
      regular.push({
        key: seg.id,
        kind: 'task',
        seg,
        ownerId: seg.owner,
        task: owner,
        path: owner ? pathOf(nodes, owner.id) : ['Items'],
        rows: shown,
        pinned: false,
        collapsed: false,
        ...stats(rows, owner),
      });
    }
  }

  // split markers: segments of the same owner, in display order
  const counts = new Map<string, number>();
  for (const c of regular) if (c.kind === 'task') counts.set(c.ownerId, (counts.get(c.ownerId) ?? 0) + 1);
  const idx = new Map<string, number>();
  for (const c of regular) {
    if (c.kind !== 'task') continue;
    const n = counts.get(c.ownerId)!;
    const i = (idx.get(c.ownerId) ?? 0) + 1;
    idx.set(c.ownerId, i);
    // a pulled card's owner is itself a row elsewhere: that row is part 1
    if (c.seg?.pulled) c.part = { i: i + 1, n: n + 1 };
    else if (n > 1) c.part = { i, n };
  }

  pinned.sort((a, b) => a.meeting!.dayOffset - b.meeting!.dayOffset || a.meeting!.eff - b.meeting!.eff);
  attention.sort((a, b) => nodes.indexOf(a.rows[0].node!) - nodes.indexOf(b.rows[0].node!));
  const cards = [...pinned, ...attention, ...regular];
  const all = cards.reduce((a, c) => ({ done: a.done + c.done, total: a.total + c.total }), { done: 0, total: 0 });
  return { cards, ...all };
}

/** item cards have no header: every line in them is a row (only meetings and alerts carry a header) */
export const isLoose = (c: CardM) => c.kind === 'task';

/** is `id` inside the subtree of `anc` (or `anc` itself)? */
export function isUnder(nodes: Node[], id: string, anc: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let cur: string | null | undefined = id, i = 0; cur && i < 100; cur = byId.get(cur)?.parentId, i++) if (cur === anc) return true;
  return false;
}

/** keep the selection valid whatever happens to the cards (undo, delete, collapse…) */

export function effSel(cards: CardM[], sel: Nsel): Nsel {
  let c = cards.find((x) => x.key === sel.card);
  // the selected row moved to another card (outdent, split, undo…): follow it
  if (sel.row && !c?.rows.some((r) => r.id === sel.row)) c = cards.find((x) => x.rows.some((r) => r.id === sel.row)) ?? c;
  if (!c) c = cards[0];
  if (!c) return { card: null, row: null };
  let row = sel.row && !c.collapsed && c.rows.some((r) => r.id === sel.row) ? sel.row : null;
  if (!row && isLoose(c)) row = c.rows[0]?.id ?? null; // a headerless card has nothing to select but its rows
  return { card: c.key, row };
}

/** flat keyboard order of a Next list: every card header followed by its rows */
export interface NavEntry {
  card: string;
  row: string | null;
  item: string | null; // item id this entry stands for (null for calendar items)
}
export function navList(cards: CardM[]): NavEntry[] {
  const out: NavEntry[] = [];
  for (const c of cards) {
    if (!isLoose(c)) out.push({ card: c.key, row: null, item: c.task?.id ?? null });
    if (!c.collapsed) for (const r of c.rows) out.push({ card: c.key, row: r.id, item: r.node?.id ?? null });
  }
  return out;
}

/** The next concrete actions to suggest for focus */
export function nextActions(s: State, excludeId?: string): Node[] {
  const out: Node[] = [];
  for (const c of nextModel(s).cards) {
    if (c.kind !== 'task') continue;
    for (const r of c.rows)
      if (r.node && !r.kids && r.node.status !== 'done' && r.node.status !== 'dropped' && r.node.id !== excludeId && !r.node.smart) out.push(r.node);
  }
  return out;
}

/** can this item be started directly? (a leaf that is neither finished nor external) */
export const startable = (n: Node, nodes: Node[]) => n.status !== 'done' && n.status !== 'dropped' && !n.smart && !hasKids(nodes, n.id);
