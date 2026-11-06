import type { Node, State } from './store';
import { childrenOf, pathOf } from './model';

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
  const fallback = nodes.find((n) => n.id === 'p_me') ?? nodes.find((n) => n.kind === 'project');
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
    .filter((n) => n.kind === 'action' && !n.today && n.status === 'todo' && !n.smart)
    .sort((a, b) => (a.lastRun ?? 0) - (b.lastRun ?? 0) || (a.est ?? 99) - (b.est ?? 99));
  const already = s.nodes.filter((n) => n.today && n.status !== 'done' && n.kind === 'action').length;
  return cand.slice(0, Math.max(0, 5 - already)).map((n) => n.id);
}

export const breadcrumb = (nodes: Node[], id: string | null) => pathOf(nodes, id).join(' › ');
export const hasKids = (nodes: Node[], id: string) => childrenOf(nodes, id).length > 0;
