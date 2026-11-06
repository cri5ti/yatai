import type { Flags, Meeting, Node, State } from './store';

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

export const childrenOf = (nodes: Node[], id: string | null) => nodes.filter((n) => n.parentId === id);

export function pathOf(nodes: Node[], id: string | null): string[] {
  const out: string[] = [];
  let cur = id;
  while (cur) {
    const n = nodes.find((x) => x.id === cur);
    if (!n) break;
    out.unshift(n.title);
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

export interface EffMeeting extends Meeting {
  eff: number;
  movedFrom?: number;
  minsAway: number;
  state: 'upcoming' | 'now' | 'done';
}

export function meetingsFor(s: State): EffMeeting[] {
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

export type Card =
  | { key: string; prio: number; order: number; kind: 'meeting'; meeting: EffMeeting }
  | { key: string; prio: number; order: number; kind: 'attention'; node: Node; path: string[] }
  | { key: string; prio: number; order: number; kind: 'task'; parent: Node | null; path: string[]; items: Node[] };

export function todayModel(s: State) {
  const { nodes, flags } = s;
  const meetings = meetingsFor(s);
  const cards: Card[] = [];
  const later: EffMeeting[] = [];

  for (const m of meetings) {
    if (m.state === 'done') continue;
    if (m.state === 'now' || m.minsAway <= 30) cards.push({ key: m.id, prio: 0, order: m.eff, kind: 'meeting', meeting: m });
    else later.push(m);
  }

  const isLeaf = (n: Node) => n.kind === 'action' || (n.kind === 'task' && !nodes.some((c) => c.parentId === n.id));
  const todayLeaves = nodes.filter((n) => n.today && n.kind !== 'project' && isLeaf(n));

  const groups = new Map<string | null, Node[]>();
  for (const n of todayLeaves) {
    if (n.status !== 'done' && needsAttention(n, flags)) {
      cards.push({ key: 'att_' + n.id, prio: 1, order: nodes.indexOf(n), kind: 'attention', node: n, path: pathOf(nodes, n.parentId) });
      continue;
    }
    groups.set(n.parentId, [...(groups.get(n.parentId) ?? []), n]);
  }
  let done = 0;
  for (const [pid, items] of groups) {
    done += items.filter((i) => i.status === 'done').length;
    if (items.every((i) => i.status === 'done')) continue;
    const parent = nodes.find((n) => n.id === pid) ?? null;
    cards.push({
      key: 'task_' + pid,
      prio: 2,
      order: nodes.indexOf(items[0]),
      kind: 'task',
      parent,
      path: pathOf(nodes, pid),
      items,
    });
  }
  cards.sort((a, b) => a.prio - b.prio || a.order - b.order);
  return { cards, later, done, total: todayLeaves.length, meetings };
}

/** The next concrete action to suggest for focus: first non-done, non-attention action in the cards. */
export function nextActions(s: State, excludeId?: string): Node[] {
  const { cards } = todayModel(s);
  const out: Node[] = [];
  for (const c of cards) {
    if (c.kind === 'task') out.push(...c.items.filter((i) => i.status !== 'done' && i.id !== excludeId && !i.smart));
  }
  return out;
}
