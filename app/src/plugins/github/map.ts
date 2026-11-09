/** GitHub → what yatai shows. Pure: the GraphQL shapes in, snapshots out (so it can be tested without a network). */
import type { Alert, Detail, Snapshot, Tone } from '../types';
import { refKey } from '../types';
import { relTime } from '../../model';

export const LABELS: Record<string, string> = {
  draft: 'draft',
  review: 'to review',
  feedback: 'has feedback',
  building: 'checks running',
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
  pending: boolean; // checks queued or still running
  conflicts: boolean;
  /** the failing checks, with their first real error and the run to look at */
  fails?: { name: string; error?: string; url?: string }[];
  /** the unresolved review threads, by their first comment */
  open?: { id: string; author: string; body: string; path?: string; url?: string }[];
  oid?: string; // the head commit: a check failing again on a later commit is a new failure
}
export const noFacts: Facts = { draft: false, merged: false, closed: false, failing: null, threads: 0, changesRequested: false, approved: false, checksOk: true, pending: false, conflicts: false };

/** "what needs me" beats "what is true": the first match decides the glyph */
export function summarize(f: Facts): { view: { glyph: string; label: string; tone: Tone; count?: number }; alerts: Alert[] } {
  const open = !f.merged && !f.closed;
  const alerts: Alert[] = [];
  const err = f.fails?.find((x) => x.name === f.failing)?.error;
  if (open && f.failing) alerts.push({ key: 'checks:failed', tone: 'bad', text: `Build failed: ${f.failing}`, toast: `Build failed: ${f.failing}${err ? ` — ${err}` : ''}` });
  if (open && f.threads > 0) alerts.push({ key: `threads:${f.threads}`, tone: 'warn', text: `${f.threads} unresolved comment${f.threads === 1 ? '' : 's'}` });
  else if (open && f.changesRequested) alerts.push({ key: 'changes', tone: 'warn', text: 'Changes requested' });
  if (open && f.conflicts) alerts.push({ key: 'conflict', tone: 'warn', text: 'Merge conflicts' });
  const ready = open && !f.draft && f.approved && f.checksOk && !f.failing && !f.conflicts;
  if (ready) alerts.push({ key: 'ready', tone: 'good', text: 'Approved · mergeable' });
  if (open && f.pending && !f.failing) alerts.push({ key: 'checks:pending', tone: 'info', text: 'Checks running' });
  if (open && !alerts.length) alerts.push({ key: 'review', tone: 'info', text: f.draft ? 'Draft' : 'Awaiting review' });

  const glyph = f.merged ? 'merged' : f.closed ? 'closed' : f.draft ? 'draft' : f.failing ? 'failing' : f.threads > 0 || f.changesRequested ? 'feedback' : f.pending ? 'building' : ready ? 'ready' : 'review';
  return { view: { glyph, label: LABELS[glyph], tone: TONES[glyph] ?? 'info', ...(glyph === 'feedback' ? { count: Math.max(1, f.threads) } : {}), ...(glyph === 'building' ? { quiet: true } : {}) }, alerts };
}

const clip = (t: string, n: number) => {
  const one = t.replace(/\r/g, '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('```') && !l.startsWith('>')) ?? '';
  return one.length > n ? one.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : one;
};
/** what to act on inside an open PR: each failing check (per head commit) and each unresolved review thread */
export function detailsOf(f: Facts): Detail[] {
  if (f.merged || f.closed) return [];
  const out: Detail[] = [];
  for (const c of f.fails ?? []) out.push({ key: `check:${c.name}@${(f.oid ?? '').slice(0, 7)}`, text: `Build failed: ${c.name}${c.error ? ` — ${clip(c.error, 140)}` : ''}`, url: c.url });
  for (const t of f.open ?? []) out.push({ key: `thread:${t.id}`, text: `@${t.author}${t.path ? ` on ${t.path.split('/').pop()}` : ''}: ${clip(t.body, 120) || '(comment)'}`, url: t.url });
  return out;
}

export function snapshot(ref: string, name: string, title: string, f: Facts): Snapshot {
  const { view, alerts } = summarize(f);
  const details = detailsOf(f);
  return { ref, name, title, view, alerts, details, rev: JSON.stringify([view.glyph, view.count, alerts.map((a) => a.key), title, details.map((d) => d.key + d.text)]) };
}

/**
 * The cheap fields, asked for every PR on every poll (about 3 GraphQL "requests" per PR, i.e. ~0.03 points):
 * enough for the state, the counts and to notice that something changed.
 */
export const PR_LIGHT = `fragment F on PullRequest {
  number title body url state isDraft merged mergeable reviewDecision updatedAt
  author { login }
  repository { nameWithOwner }
  reviewThreads(first: 100) { nodes { isResolved } }
  commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 50) { nodes {
    __typename
    ... on CheckRun { name status conclusion }
    ... on StatusContext { context state }
  } } } } } }
}`;

/** what the light fields say; a different value means the PR changed and its details are worth fetching again */
export function basisOf(p: GqlPr): string {
  const roll = p.commits.nodes[0]?.commit.statusCheckRollup;
  return JSON.stringify([
    p.state, p.isDraft, p.merged, p.mergeable, p.reviewDecision, p.updatedAt,
    p.reviewThreads.nodes.filter((t) => !t.isResolved).length,
    p.commits.nodes[0]?.commit.oid, roll?.state,
    (roll?.contexts.nodes ?? []).map((c) => (c ? `${c.name ?? c.context}:${c.status ?? ''}:${c.conclusion ?? c.state ?? ''}` : '')),
  ]);
}

/**
 * Everything, details included (thread comments, check annotations: ~1.5 points per PR). Only asked for a PR that is
 * new, whose light fields changed, or that the user refreshed.
 */
export const PR_FIELDS = `fragment F on PullRequest {
  number title body url state isDraft merged mergeable reviewDecision updatedAt
  author { login }
  repository { nameWithOwner }
  reviewThreads(first: 100) { nodes { id isResolved path comments(first: 1) { nodes { author { login } body url } } } }
  commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 50) { nodes {
    __typename
    ... on CheckRun { name status conclusion detailsUrl title summary annotations(first: 10) { nodes { annotationLevel message path } } }
    ... on StatusContext { context state description targetUrl }
  } } } } } }
}`;

export interface GqlPr {
  number: number;
  title: string;
  body?: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  merged: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  updatedAt: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  reviewThreads: { nodes: { id?: string; isResolved: boolean; path?: string | null; comments?: { nodes: { author: { login: string } | null; body: string; url: string }[] } }[] };
  commits: { nodes: { commit: { oid?: string; statusCheckRollup: { state: string; contexts: { nodes: (GqlCheck | null)[] } } | null } }[] };
}

type GqlCheck = {
  __typename: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  detailsUrl?: string | null;
  title?: string | null;
  summary?: string | null;
  annotations?: { nodes: { annotationLevel: string; message: string; path?: string }[] };
  context?: string;
  state?: string;
  description?: string | null;
  targetUrl?: string | null;
};

const BAD_CHECK = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ERROR']);
/** the first message that says what went wrong: a failure annotation that is not just "exit code 1", else the check's own title */
function errorOf(c: GqlCheck): string | undefined {
  const notes = (c.annotations?.nodes ?? []).filter((a) => a.annotationLevel === 'FAILURE');
  const real = notes.find((a) => !/^Process completed with exit code/i.test(a.message)) ?? notes[0];
  if (real) return `${real.message}${real.path && real.path !== '.github' ? ` (${real.path})` : ''}`;
  return c.title || c.summary || c.description || undefined;
}

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
  const fails = (roll?.contexts.nodes ?? []).flatMap((c) =>
    !c
      ? []
      : c.__typename === 'CheckRun' && c.conclusion && BAD_CHECK.has(c.conclusion)
        ? [{ name: c.name ?? 'check', error: errorOf(c), url: c.detailsUrl ?? undefined }]
        : c.__typename === 'StatusContext' && c.state && BAD_CHECK.has(c.state)
          ? [{ name: c.context ?? 'status', error: errorOf(c), url: c.targetUrl ?? undefined }]
          : [],
  );
  const open = p.reviewThreads.nodes
    .filter((t) => !t.isResolved && t.id)
    .map((t) => {
      const c = t.comments?.nodes[0];
      return { id: t.id!, author: c?.author?.login ?? 'someone', body: c?.body ?? '', path: t.path ?? undefined, url: c?.url };
    });
  // the rollup says PENDING / EXPECTED while anything is queued or running; a check run says so itself too
  const pending =
    !!roll &&
    (roll.state === 'PENDING' ||
      roll.state === 'EXPECTED' ||
      (roll.contexts.nodes ?? []).some((c) => (c?.__typename === 'CheckRun' && c.status && c.status !== 'COMPLETED') || (c?.__typename === 'StatusContext' && (c.state === 'PENDING' || c.state === 'EXPECTED'))));
  return {
    draft: p.isDraft,
    merged: p.merged || p.state === 'MERGED',
    closed: p.state === 'CLOSED' && !p.merged,
    failing,
    threads: p.reviewThreads.nodes.filter((t) => !t.isResolved).length,
    changesRequested: p.reviewDecision === 'CHANGES_REQUESTED',
    approved: p.reviewDecision === 'APPROVED',
    checksOk: !roll || roll.state === 'SUCCESS',
    pending,
    fails,
    open,
    oid: p.commits.nodes[0]?.commit.oid,
    conflicts: p.mergeable === 'CONFLICTING',
  };
}

export const shortName = (p: GqlPr) => `${p.repository.nameWithOwner.split('/')[1]}#${p.number}`;
/** `acme/api#482` — the id half of the ref */
export const prId = (p: GqlPr) => `${p.repository.nameWithOwner}#${p.number}`;
/** a PR description as a few lines of note: no HTML comments / tags, no runs of blank lines, not endless */
export function cleanBody(b: string | undefined): string {
  const t = (b ?? '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > 1500 ? t.slice(0, 1500).replace(/\s+\S*$/, '') + ' …' : t;
}
/**
 * `full`: fetched with PR_FIELDS, so it carries the details and the basis they were fetched at. A light snapshot (the
 * drawer lists) has neither: no details means "not known", never "none outstanding".
 */
export const toSnapshot = (p: GqlPr, full = true): Snapshot => {
  const sn = { ...snapshot(refKey('github', prId(p)), shortName(p), p.title, factsOf(p)), desc: cleanBody(p.body) };
  return full ? { ...sn, basis: basisOf(p) } : { ...sn, details: undefined };
};
export const ago = (iso: string) => relTime(Date.parse(iso));
