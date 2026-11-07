import type { Flags, Meeting, Node, Nsel, PrStatus, Seg, State } from './store';

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
const PR_SRC = 'https://github\\.com/([\\w.-]+)/([\\w.-]+)/pulls?/(\\d+)';
export interface PrLink {
  key: string; // org/repo#123
  org: string;
  repo: string;
  num: string;
  url: string;
}
/** every PR link in a piece of text (a url, with or without trailing path) */
export function prLinks(text: string): PrLink[] {
  const re = new RegExp(PR_SRC + '(?:[/?#][^\\s)]*)?', 'g');
  const out: PrLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ key: `${m[1]}/${m[2]}#${m[3]}`, org: m[1], repo: m[2], num: m[3], url: m[0] });
  return out;
}
export const prMatch = (url: string) => new RegExp('^' + PR_SRC).exec(url);
/** text for places that cannot render a link: PR urls become repo#123 */
export const plain = (text: string) => text.replace(new RegExp(PR_SRC + '(?:[/?#][^\\s)]*)?', 'g'), (_, _o, r, n) => `${r}#${n}`);

/** PR states that want your attention (like a smart item with a non-neutral alert) */
export const PR_ATTENTION: PrStatus[] = ['failing', 'feedback', 'ready'];
export function prAttention(n: Node, prs: Record<string, PrStatus>) {
  if (n.status === 'done') return false;
  return prLinks(n.title.split('\n')[0]).some((l) => PR_ATTENTION.includes(prs[l.key] ?? 'review'));
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
/** what hovering / moving the cursor onto a row clears: the row itself, or what is hidden under it */
export function hlForRow(nodes: Node[], hl: Record<string, true>, row: Row): string[] {
  if (!row.node || !Object.keys(hl).length) return [];
  if (hl[row.node.id]) return [row.node.id];
  return row.kids && row.node.open === false ? hlSubtree(nodes, hl, row.node.id) : [];
}
/** …and a card: a changed meeting, or anything changed inside a collapsed card */
export function hlForCard(nodes: Node[], hl: Record<string, true>, card: CardM): string[] {
  if (!Object.keys(hl).length) return [];
  if (card.kind === 'meeting' && hl[card.ownerId]) return [card.ownerId];
  return card.collapsed ? card.rows.flatMap((r) => (r.node ? hlSubtree(nodes, hl, r.node.id) : [])) : [];
}

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

export interface Alert {
  tone: 'bad' | 'warn' | 'good' | 'info';
  text: string;
}

export function alertsFor(n: Node, f: Flags): Alert[] {
  if (!n.smart || n.status === 'done') return [];
  const a: Alert[] = [];
  switch (n.smart.source) {
    case 'pr':
      if (f.prBuildFailing) a.push({ tone: 'bad', text: 'Build failed' });
      if (f.prNewComments) a.push({ tone: 'warn', text: '3 new comments' });
      if (f.prApproved) a.push({ tone: 'good', text: 'Approved · mergeable' });
      if (!a.length) a.push({ tone: 'info', text: 'Awaiting review' });
      break;
    case 'pipeline':
      a.push(f.pipelineFailed ? { tone: 'bad', text: 'Deploy failed at "prod-eu"' } : { tone: 'info', text: 'Deploying · stage 2/4' });
      break;
    case 'workitem':
      a.push(f.workItemChanged ? { tone: 'warn', text: 'State: Active → Resolved' } : { tone: 'info', text: 'Active' });
      break;
    case 'ai':
      if (f.aiNeedsFeedback) a.push({ tone: 'warn', text: 'Claude needs feedback' });
      else if (f.aiDone) a.push({ tone: 'good', text: 'Session finished' });
      else a.push({ tone: 'info', text: 'Claude working…' });
      break;
  }
  return a;
}

export const needsAttention = (n: Node, f: Flags) => alertsFor(n, f).some((a) => a.tone !== 'info');

/* ---------- meetings ---------- */
export interface EffMeeting extends Meeting {
  eff: number;
  movedFrom?: number;
  minsAway: number;
  state: 'upcoming' | 'now' | 'done';
}

export function meetingsFor(s: Pick<State, 'meetings' | 'flags' | 'clock'>): EffMeeting[] {
  return s.meetings
    .map((m) => {
      const moved = s.flags.meetingMoved && m.movedTo != null;
      const eff = moved ? m.movedTo! : m.start;
      const minsAway = eff - s.clock;
      const state: EffMeeting['state'] = minsAway > 0 ? 'upcoming' : minsAway + m.durationMin > 0 ? 'now' : 'done';
      return { ...m, eff, movedFrom: moved ? m.start : undefined, minsAway, state };
    })
    .sort((a, b) => a.eff - b.eff);
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
/** an item with children is done when all of its leaves are; a leaf is done when marked */
export function doneOf(nodes: Node[], id: string): boolean {
  const leaves = leavesOf(nodes, id).filter((n) => n.status !== 'dropped');
  return leaves.length > 0 && leaves.every((n) => n.status === 'done');
}

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
  const valid = (owner: string, id: string) => {
    if (id.startsWith(FX)) return id === FX + owner && mIds.has(owner);
    const n = byId.get(id);
    return !!n && isRootRow(n) && ownerOf(n) === owner;
  };

  const seen = new Set<string>();
  const segs: Seg[] = [];
  for (const sg of plan) {
    if (!isOwner(sg.owner)) continue;
    const items = sg.items.filter((id) => {
      if (!valid(sg.owner, id) || seen.has(id)) return false;
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
    if (sg) sg.items.push(id);
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
  depth: number; // 0 = directly under the card header
  kids: boolean; // has Next children nested below it
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

export function nextModel(s: Pick<State, 'nodes' | 'plan' | 'meetings' | 'flags' | 'clock' | 'prs'>) {
  const { nodes, flags } = s;
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
      allDone: owner?.status === 'done' || (!empty && done === live.length),
    };
  };

  /** a root row followed by its Next descendants, depth-first in tree order */
  const expand = (n: Node, depth: number, out: Row[]) => {
    const kids = nodes.filter((c) => c.parentId === n.id && c.today);
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
      if ((n.smart && n.status !== 'done' && needsAttention(n, flags)) || prAttention(n, s.prs)) {
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
      regular.push({
        key: seg.id,
        kind: 'task',
        seg,
        ownerId: seg.owner,
        task: owner,
        path: owner ? pathOf(nodes, owner.id) : ['Items'],
        rows,
        pinned: false,
        collapsed: owner ? owner.open === false : false,
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
    if (n > 1) c.part = { i, n };
  }

  pinned.sort((a, b) => a.meeting!.eff - b.meeting!.eff);
  attention.sort((a, b) => nodes.indexOf(a.rows[0].node!) - nodes.indexOf(b.rows[0].node!));
  const cards = [...pinned, ...attention, ...regular];
  const all = cards.reduce((a, c) => ({ done: a.done + c.done, total: a.total + c.total }), { done: 0, total: 0 });
  return { cards, ...all };
}

/** keep the selection valid whatever happens to the cards (undo, delete, collapse…) */
/** the card of top-level items: it has no header, anything can sit at the top level */
export const isLoose = (c: CardM) => c.kind === 'task' && c.ownerId === ROOT;

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
