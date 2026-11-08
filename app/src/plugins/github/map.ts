/** GitHub → what yatai shows. Pure: the GraphQL shapes in, snapshots out (so it can be tested without a network). */
import type { Alert, Snapshot, Tone } from '../types';
import { refKey } from '../types';
import { relTime } from '../../model';

export const LABELS: Record<string, string> = {
  draft: 'draft',
  review: 'to review',
  feedback: 'has feedback',
  failing: 'build fails',
  ready: 'ready',
  merged: 'merged',
  closed: 'closed',
};
const TONES: Record<string, Tone> = { failing: 'bad', feedback: 'warn', ready: 'good', merged: 'good' };

/** the facts that decide a PR's state, whichever way they were learned */
export interface Facts {
  draft: boolean;
  merged: boolean;
  closed: boolean;
  failing: string | null; // the first failing check, if any
  threads: number; // unresolved review threads
  changesRequested: boolean;
  approved: boolean;
  checksOk: boolean; // every check passed (or there are none)
  conflicts: boolean;
}
export const noFacts: Facts = { draft: false, merged: false, closed: false, failing: null, threads: 0, changesRequested: false, approved: false, checksOk: true, conflicts: false };

/** "what needs me" beats "what is true": the first match decides the glyph */
export function summarize(f: Facts): { view: { glyph: string; label: string; tone: Tone; count?: number }; alerts: Alert[] } {
  const open = !f.merged && !f.closed;
  const alerts: Alert[] = [];
  if (open && f.failing) alerts.push({ key: 'checks:failed', tone: 'bad', text: `Build failed: ${f.failing}` });
  if (open && f.threads > 0) alerts.push({ key: `threads:${f.threads}`, tone: 'warn', text: `${f.threads} unresolved comment${f.threads === 1 ? '' : 's'}` });
  else if (open && f.changesRequested) alerts.push({ key: 'changes', tone: 'warn', text: 'Changes requested' });
  if (open && f.conflicts) alerts.push({ key: 'conflict', tone: 'warn', text: 'Merge conflicts' });
  const ready = open && !f.draft && f.approved && f.checksOk && !f.failing && !f.conflicts;
  if (ready) alerts.push({ key: 'ready', tone: 'good', text: 'Approved · mergeable' });
  if (open && !alerts.length) alerts.push({ key: 'review', tone: 'info', text: f.draft ? 'Draft' : 'Awaiting review' });

  const glyph = f.merged ? 'merged' : f.closed ? 'closed' : f.draft ? 'draft' : f.failing ? 'failing' : f.threads > 0 || f.changesRequested ? 'feedback' : ready ? 'ready' : 'review';
  return { view: { glyph, label: LABELS[glyph], tone: TONES[glyph] ?? 'info', ...(glyph === 'feedback' ? { count: Math.max(1, f.threads) } : {}) }, alerts };
}

export function snapshot(ref: string, name: string, title: string, f: Facts): Snapshot {
  const { view, alerts } = summarize(f);
  return { ref, name, title, view, alerts, rev: JSON.stringify([view.glyph, view.count, alerts.map((a) => a.key), title]) };
}

/** the GraphQL fields every PR query asks for */
export const PR_FIELDS = `fragment F on PullRequest {
  number title url state isDraft merged mergeable reviewDecision updatedAt
  author { login }
  repository { nameWithOwner }
  reviewThreads(first: 100) { nodes { isResolved } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 50) { nodes {
    __typename
    ... on CheckRun { name conclusion }
    ... on StatusContext { context state }
  } } } } } }
}`;

export interface GqlPr {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  merged: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  updatedAt: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  reviewThreads: { nodes: { isResolved: boolean }[] };
  commits: { nodes: { commit: { statusCheckRollup: { state: string; contexts: { nodes: ({ __typename: string; name?: string; conclusion?: string | null; context?: string; state?: string } | null)[] } } | null } }[] };
}

const BAD_CHECK = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ERROR']);

export function factsOf(p: GqlPr): Facts {
  const roll = p.commits.nodes[0]?.commit.statusCheckRollup ?? null;
  let failing: string | null = null;
  for (const c of roll?.contexts.nodes ?? []) {
    if (!c) continue;
    if (c.__typename === 'CheckRun' && c.conclusion && BAD_CHECK.has(c.conclusion)) (failing = c.name ?? 'check');
    if (c.__typename === 'StatusContext' && c.state && BAD_CHECK.has(c.state)) failing = c.context ?? 'status';
    if (failing) break;
  }
  if (!failing && roll && BAD_CHECK.has(roll.state)) failing = 'checks';
  return {
    draft: p.isDraft,
    merged: p.merged || p.state === 'MERGED',
    closed: p.state === 'CLOSED' && !p.merged,
    failing,
    threads: p.reviewThreads.nodes.filter((t) => !t.isResolved).length,
    changesRequested: p.reviewDecision === 'CHANGES_REQUESTED',
    approved: p.reviewDecision === 'APPROVED',
    checksOk: !roll || roll.state === 'SUCCESS',
    conflicts: p.mergeable === 'CONFLICTING',
  };
}

export const shortName = (p: GqlPr) => `${p.repository.nameWithOwner.split('/')[1]}#${p.number}`;
/** `acme/api#482` — the id half of the ref */
export const prId = (p: GqlPr) => `${p.repository.nameWithOwner}#${p.number}`;
export const toSnapshot = (p: GqlPr): Snapshot => snapshot(refKey('github', prId(p)), shortName(p), p.title, factsOf(p));
export const ago = (iso: string) => relTime(Date.parse(iso));
