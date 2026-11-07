import type { Node, PrStatus, State } from './store';
import { childrenOf, nextActions, nextModel, pathOf } from './model';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const rules: [RegExp, string, string][] = [
  [/staff|payroll|extract/i, 't_staff', 'Mentions staff extraction'],
  [/vector|embed|sqlite|similar/i, 't_vec', 'Related to the vector search spike'],
  [/release|deploy|merge|checklist|pr\b/i, 't_rel', 'Looks like release work'],
  [/claude|vitest|test/i, 't_ai', 'Related to test migration'],
  [/tax|accountant|receipt/i, 't_tax', 'Matches Taxes 2026'],
];

export function aiSuggest(text: string, nodes: Node[]) {
  for (const [re, id, reason] of rules) {
    if (nodes.some((n) => n.id === id) && re.test(text)) {
      return { parentId: id, reason: `${reason} · you filed 3 similar items there` };
    }
  }
  const fallback = nodes.find((n) => n.id === 'p_me') ?? nodes.find((n) => !n.parentId);
  return fallback ? { parentId: fallback.id, reason: 'Low confidence — no similar items found' } : null;
}

export function aiBreakdown(title: string): { title: string; est: number }[] {
  const t = title.toLowerCase();
  if (/spike|compare|research/.test(t))
    return [
      { title: 'Write down evaluation criteria', est: 15 },
      { title: 'Build minimal prototype for each option', est: 90 },
      { title: 'Benchmark and capture results', est: 45 },
      { title: 'Write recommendation (1 page)', est: 30 },
    ];
  if (/release|deploy/.test(t))
    return [
      { title: 'Freeze scope and tag candidate', est: 15 },
      { title: 'Run full regression suite', est: 30 },
      { title: 'Update changelog and notes', est: 20 },
      { title: 'Promote to prod and verify', est: 25 },
    ];
  return [
    { title: `Clarify the goal of "${title}"`, est: 15 },
    { title: 'Draft a first pass', est: 45 },
    { title: 'Review and refine', est: 30 },
    { title: 'Share / hand off', est: 10 },
  ];
}

export const aiEstimate = (title: string) => {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [10, 15, 20, 30, 45, 60, 90][h % 7];
};

/** pick up to 4 not-yet-today open actions, preferring neglected + estimated ones */
export function aiPlan(s: State): string[] {
  const cand = s.nodes
    .filter((n) => !s.nodes.some((c) => c.parentId === n.id) && n.parentId && !n.today && n.status === 'todo' && !n.smart)
    .sort((a, b) => (a.lastRun ?? 0) - (b.lastRun ?? 0) || (a.est ?? 99) - (b.est ?? 99));
  const already = s.nodes.filter((n) => n.today && n.status !== 'done').length;
  return cand.slice(0, Math.max(0, 5 - already)).map((n) => n.id);
}

export const breadcrumb = (nodes: Node[], id: string | null) => pathOf(nodes, id).join(' › ');
export const hasKids = (nodes: Node[], id: string) => childrenOf(nodes, id).length > 0;

/* ---------- AI popup (mocked conversation) ---------- */
export interface AiReply {
  text: string;
  intent?: 'plan' | 'breakdown';
}

export function aiReply(q: string, ctx: string | undefined, s: State): AiReply {
  const t = q.toLowerCase();
  const about = ctx ? `**${ctx}**` : 'your list';
  if (/break|split|steps|subtask/.test(t))
    return {
      intent: 'breakdown',
      text: `Here is how I'd break down ${about}:\n1. Clarify the goal and the definition of done\n2. Draft a first pass\n3. Review and refine\n4. Share / hand off\n\nI can add these as actions.`,
    };
  if (/plan|today|schedule|what.*(next|do)|start/.test(t)) {
    const next = nextActions(s).slice(0, 3);
    const m = s.meetings.length;
    return {
      intent: 'plan',
      text: next.length
        ? `Given ${m} meetings today I'd go in this order:\n${next.map((n, i) => `${i + 1}. **${n.title.split('\n')[0]}**${n.est ? ` (${n.est} min)` : ''}`).join('\n')}\n\nWant me to fill the rest of the day?`
        : 'Your Next list is empty — I can pull a few neglected actions in for you.',
    };
  }
  if (/estimate|how long|duration/.test(t))
    return { text: `Based on similar past work, ${about} is about **45 min** — most comparable items took 30–60 min.` };
  if (/summar|status|progress|how am i/.test(t)) {
    const m = nextModel(s);
    return { text: `You have done **${m.done} of ${m.total}** planned actions so far. ${m.total - m.done} left across ${m.cards.length} cards.` };
  }
  if (/thank/.test(t)) return { text: 'Anytime. ✨' };
  return {
    text: `(mock) I looked at ${about}. I can *break it down*, *estimate it*, *plan your day* or *summarize progress* — just ask.`,
  };
}

/* ---------- the "sources" behind the bottom drawers (all fake) ---------- */
export interface GhEntry {
  org: string;
  repo: string;
  num: string;
  title: string;
  status: PrStatus;
  comments?: number;
  note: string;
}
export const GH: Record<string, GhEntry[]> = {
  assigned: [
    { org: 'acme', repo: 'api', num: '502', title: 'Rate limiter for the token endpoint', status: 'review', note: 'requested by Priya · 1h' },
    { org: 'acme', repo: 'web', num: '1188', title: 'Fix flaky date picker', status: 'feedback', comments: 2, note: 'requested by Sam · 3h' },
    { org: 'acme', repo: 'infra', num: '77', title: 'Bump node to 22', status: 'ready', note: 'requested by Lee · 1d' },
  ],
  mine: [
    { org: 'acme', repo: 'api', num: '482', title: 'Auth token refactor', status: 'review', note: 'opened 3d ago' },
    { org: 'acme', repo: 'web', num: '1203', title: 'Claude: migrate tests to vitest', status: 'draft', note: 'opened 1d ago' },
    { org: 'acme', repo: 'api', num: '470', title: 'Remove legacy staff endpoints', status: 'merged', note: 'merged 2d ago' },
    { org: 'acme', repo: 'docs', num: '31', title: 'Document the staff extraction plan', status: 'failing', note: 'opened 5h ago' },
  ],
  mentions: [
    { org: 'acme', repo: 'web', num: '1190', title: 'Redesign settings page', status: 'review', note: 'Sam mentioned you · 2h' },
    { org: 'acme', repo: 'api', num: '498', title: 'Payroll rounding bug', status: 'feedback', comments: 5, note: 'Priya mentioned you · 6h' },
    { org: 'acme', repo: 'infra', num: '71', title: 'Retire the old staging cluster', status: 'closed', note: 'Lee mentioned you · 2d' },
  ],
};
export interface AdoEntry {
  id: string;
  title: string;
  type: 'Bug' | 'Task' | 'Story';
  state: string;
  note: string;
}
export const ADO: Record<string, AdoEntry[]> = {
  mentions: [
    { id: '18301', title: 'Staff export times out for large tenants', type: 'Bug', state: 'Active', note: 'Priya mentioned you · 1h' },
    { id: '18288', title: 'Clarify the extraction acceptance criteria', type: 'Story', state: 'New', note: 'Sam mentioned you · 1d' },
  ],
  mine: [
    { id: '18233', title: 'Flaky integration test', type: 'Bug', state: 'Active', note: 'assigned to you' },
    { id: '18310', title: 'Add an audit log for payroll changes', type: 'Task', state: 'New', note: 'assigned to you' },
    { id: '18277', title: 'Upgrade the build agents', type: 'Task', state: 'Resolved', note: 'assigned to you' },
  ],
  created: [
    { id: '18190', title: 'Investigate sqlite-vec for embeddings', type: 'Story', state: 'Active', note: 'created by you · 1w' },
    { id: '18204', title: 'Remove dead feature flags', type: 'Task', state: 'New', note: 'created by you · 4d' },
  ],
};
