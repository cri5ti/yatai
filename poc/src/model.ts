import type { Flags, Meeting, Node, Nsel, Seg, State } from './store';

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

export const childrenOf = (nodes: Node[], id: string | null) => nodes.filter((n) => n.parentId === id);

export function pathOf(nodes: Node[], id: string | null): string[] {
  const out: string[] = [];
  let cur = id;
  while (cur) {
    const n = nodes.find((x) => x.id === cur);
    if (!n) break;
    out.unshift(n.title.split('\n')[0]);
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

/* ---------- the plan: ordered segments shown as cards in Next ---------- */

/**
 * Bring the stored plan in line with the nodes: drop items that are gone / no longer in Next,
 * add newly planned actions to their task's last segment (or a new one), make sure every meeting
 * has its fixed row, and prune empty segments. Pure — callers persist the result when they commit.
 */
export function reconcilePlan(plan: Seg[], nodes: Node[], meetings: Meeting[]): Seg[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const mIds = new Set(meetings.map((m) => m.id));
  const isOwner = (id: string) => mIds.has(id) || byId.get(id)?.kind === 'task';
  const valid = (owner: string, id: string) => {
    if (id.startsWith(FX)) return id === FX + owner && mIds.has(owner);
    const n = byId.get(id);
    return !!n && n.kind === 'action' && n.parentId === owner && n.today;
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
    if (n.kind === 'action' && n.today && !seen.has(n.id) && n.parentId && isOwner(n.parentId)) {
      seen.add(n.id);
      place(n.parentId, n.id);
    }
  }
  // tasks flagged for Next with no actions yet still get a (empty) card
  for (const n of nodes) {
    if (n.kind === 'task' && n.today && !lastSegOf(n.id)) segs.push({ id: 's_' + n.id, owner: n.id, items: [] });
  }
  // meetings always carry their fixed calendar row
  for (const m of [...meetings].sort((a, b) => a.start - b.start)) {
    if (!seen.has(FX + m.id)) {
      seen.add(FX + m.id);
      place(m.id, FX + m.id);
    }
  }

  // prune empties: an owner keeps an empty segment only when it has nothing else and is flagged for Next
  const hasItems = new Set(segs.filter((sg) => sg.items.length).map((sg) => sg.owner));
  const keptEmpty = new Set<string>();
  return segs.filter((sg) => {
    if (sg.items.length) return true;
    if (hasItems.has(sg.owner) || keptEmpty.has(sg.owner)) return false;
    if (byId.get(sg.owner)?.today) {
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
}

export interface CardM {
  key: string; // seg id, or att_<node id>
  kind: 'task' | 'meeting' | 'attention';
  seg?: Seg;
  ownerId: string;
  task?: Node;
  meeting?: EffMeeting;
  path: string[];
  rows: Row[];
  part?: { i: number; n: number }; // split marker: shown on i > 1
  pinned: boolean; // by time (meetings) or by alert (attention): not user-orderable
  collapsed: boolean;
  est: number;
  done: number;
  total: number;
}

const isCounted = (n: Node) => n.status !== 'dropped';

export function nextModel(s: Pick<State, 'nodes' | 'plan' | 'meetings' | 'flags' | 'clock'>) {
  const { nodes, flags } = s;
  const plan = reconcilePlan(s.plan, nodes, s.meetings);
  const ms = new Map(meetingsFor(s).map((m) => [m.id, m]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const regular: CardM[] = [];
  const pinned: CardM[] = [];
  const attention: CardM[] = [];

  const stats = (rows: Row[]) => {
    const live = rows.filter((r) => r.node && isCounted(r.node));
    return {
      est: live.reduce((a, r) => a + (r.node!.status === 'done' ? 0 : r.node!.est ?? 0), 0),
      done: live.filter((r) => r.node!.status === 'done').length,
      total: live.length,
    };
  };

  for (const seg of plan) {
    const meeting = ms.get(seg.owner);
    const task = byId.get(seg.owner);
    const rows: Row[] = [];
    let promoted = 0;
    for (const id of seg.items) {
      if (id.startsWith(FX)) {
        if (meeting) rows.push({ id, fx: meeting });
        continue;
      }
      const n = byId.get(id)!;
      if (n.smart && n.status !== 'done' && needsAttention(n, flags)) {
        const arows: Row[] = [{ id: n.id, node: n }];
        attention.push({
          key: 'att_' + n.id,
          kind: 'attention',
          ownerId: n.parentId ?? '',
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
      rows.push({ id, node: n });
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
    } else if (task) {
      if (!rows.length && promoted) continue;
      regular.push({
        key: seg.id,
        kind: 'task',
        seg,
        ownerId: task.id,
        task,
        path: pathOf(nodes, task.id),
        rows,
        pinned: false,
        collapsed: !task.open,
        ...stats(rows),
      });
    }
  }

  // split markers: segments of the same task, in display order
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
export function effSel(cards: CardM[], sel: Nsel): Nsel {
  let c = cards.find((x) => x.key === sel.card);
  if (!c && sel.row) c = cards.find((x) => x.rows.some((r) => r.id === sel.row));
  if (!c) c = cards[0];
  if (!c) return { card: null, row: null };
  const row = sel.row && !c.collapsed && c.rows.some((r) => r.id === sel.row) ? sel.row : null;
  return { card: c.key, row };
}

/** The next concrete actions to suggest for focus */
export function nextActions(s: State, excludeId?: string): Node[] {
  const out: Node[] = [];
  for (const c of nextModel(s).cards) {
    if (c.kind !== 'task') continue;
    for (const r of c.rows) if (r.node && r.node.status !== 'done' && r.node.status !== 'dropped' && r.node.id !== excludeId && !r.node.smart) out.push(r.node);
  }
  return out;
}

/** first action that can be started inside a card / node subtree */
export const startable = (n: Node) => n.kind === 'action' && n.status !== 'done' && n.status !== 'dropped' && !n.smart;
