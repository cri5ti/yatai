import { useS } from './store';
import type { BuildStatus, PrStatus } from './store';
import { buildStatusOf, prCountOf, prStatusOf, prTurnOf, smartRef } from './model';
import type { Node, State } from './store';
import type { Snapshot, Turn } from './plugins/types';
import { pluginOf } from './plugins/types';
import { implFor, pluginById } from './plugins/registry';
import { BUILD_LABELS } from './plugins/devops/map';

export const PR_STATUSES: { id: PrStatus; label: string }[] = [
  { id: 'draft', label: 'draft' },
  { id: 'review', label: 'to review' },
  { id: 'building', label: 'checks running' },
  { id: 'feedback', label: 'has feedback' },
  { id: 'failing', label: 'build fails' },
  { id: 'ready', label: 'ready' },
  { id: 'merged', label: 'merged' },
  { id: 'closed', label: 'closed' },
];
export const prLabel = (s: PrStatus) => PR_STATUSES.find((x) => x.id === s)?.label ?? s;
/** unresolved review comments when a PR "has feedback" and nothing says otherwise */
export const DEFAULT_COMMENTS = 3;

/** the GitHub mark — an inline-block, so it sits in the text flow like a character */
export function GhIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`gh ${className}`} width="12" height="12" viewBox="0 0 16 16" aria-label="GitHub" role="img">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

const ring = <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />;
const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
/** one tiny glyph per state (no glyph for "has feedback": that one is a count) */
const GLYPH: Record<PrStatus, JSX.Element | null> = {
  draft: <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.7 2.3" />,
  review: (
    <>
      {ring}
      <circle cx="8" cy="8" r="2.3" fill="currentColor" />
    </>
  ),
  building: <path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8" {...line} strokeWidth="2.1" />,
  feedback: null,
  failing: <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" {...line} strokeWidth="2.2" />,
  ready: <path d="M3.8 8.4l3 3 5.6-6.4" {...line} strokeWidth="2.2" />,
  merged: (
    <>
      <circle cx="4.5" cy="3.6" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="4.5" cy="12.4" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="11.6" cy="9.2" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 5.3v5.4M4.5 5.6c0 2.3 2.6 3.6 5.4 3.6" {...line} strokeWidth="1.6" />
    </>
  ),
  closed: (
    <>
      {ring}
      <path d="M4.8 11.2l6.4-6.4" {...line} />
    </>
  ),
};

/** what the turn adds to the tooltip */
const TURN_TIP: Record<Turn, string> = { me: 'your move', them: 'waiting on someone else' };
function feedbackTip(n: number, turn?: Turn) {
  const c = `${n} unresolved comment${n === 1 ? '' : 's'}`;
  if (turn === 'me') return `has feedback — ${c}, yours to address`;
  if (turn === 'them') return `has feedback — ${c}, waiting on the others (you have answered, or it is your review on their PR)`;
  return `has feedback — ${c}`;
}

/**
 * a PR's state as a tiny icon — or, for "has feedback", a count pill of unresolved comments. Coloured by whose move it is
 * (`turn`): deep blue = mine to act on, muted purple = waiting on someone else; merged green, closed grey.
 */
export function PrState({ status, comments = DEFAULT_COMMENTS, turn }: { status: PrStatus; comments?: number; turn?: Turn }) {
  const t = turn ? ` t-${turn}` : '';
  if (status === 'feedback') {
    const n = Math.max(1, comments);
    return (
      <span className={`prc${t}`} title={feedbackTip(n, turn)} aria-label={`${n} unresolved comments`}>
        {n}
      </span>
    );
  }
  const label = turn ? `${prLabel(status)} — ${TURN_TIP[turn]}` : prLabel(status);
  return (
    <svg className={`prsi pr-${status}${t}`} width="15" height="15" viewBox="0 0 16 16" role="img" aria-label={label}>
      <title>{label}</title>
      {/* a filled disc in the status colour with the glyph knocked out in the surface colour */}
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <g className="prg" transform="translate(8 8) scale(.66) translate(-8 -8)">
        {GLYPH[status]}
      </g>
    </svg>
  );
}

/* ---------- no known state: never guess one ---------- */
/** is this source on (connected, or the demo's mock)? */
const sourceOn = (s: State, id: string) => {
  const p = pluginById(id);
  return !!p && !!implFor(p, s);
};
/** the "not connected" mark: an unplugged plug, as an outline (it is not a state) */
export function Offline({ title, warn = false }: { title: string; warn?: boolean }) {
  return (
    <svg className={`prsi off${warn ? ' warn' : ''}`} width="15" height="15" viewBox="0 0 16 16" role="img" aria-label={title}>
      <title>{title}</title>
      <g {...line} strokeWidth="1.5">
        <path d="M6.2 2.6v2.6M9.8 2.6v2.6" />
        <path d="M4.6 5.2h6.8v2.4a3.4 3.4 0 0 1-6.8 0z" />
        <path d="M8 11v2.6" />
        <path d="M2.6 13.4L13.4 2.6" />
      </g>
    </svg>
  );
}
/**
 * in place of a state that is not known: the "not connected" mark when the source is off, or (warn) when it cannot see
 * this one; nothing while it is on but has not said yet
 */
function NoState({ s, plugin, snap }: { s: State; plugin: string; snap?: Snapshot }) {
  const name = pluginById(plugin)?.name ?? plugin;
  if (!sourceOn(s, plugin)) return <Offline title={`${name} is not connected (Settings → ${name})`} />;
  if (snap?.gone) return <Offline warn title={snap.alerts[0]?.toast ?? snap.alerts[0]?.text ?? `${name} cannot see it`} />;
  return null;
}
/** beside a smart item (a work item, a pipeline, an AI session) whose source is off or cannot see it */
export function SourceOff({ node }: { node: Node }) {
  const s = useS();
  const ref = smartRef(node);
  if (!ref) return null;
  const sn = s.snaps[ref];
  return sn && !sn.gone ? null : <NoState s={s} plugin={pluginOf(ref)} snap={sn} />;
}

/* ---------- Azure DevOps pipeline runs ---------- */
export const BUILD_STATUSES: { id: BuildStatus; label: string }[] = (Object.keys(BUILD_LABELS) as BuildStatus[]).map((id) => ({ id, label: BUILD_LABELS[id] }));
const BGLYPH: Record<BuildStatus, JSX.Element> = {
  queued: <path d="M8 4.2V8l2.6 1.6" {...line} strokeWidth="2" />,
  building: <path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8" {...line} strokeWidth="2.1" />,
  failed: <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" {...line} strokeWidth="2.2" />,
  done: <path d="M3.8 8.4l3 3 5.6-6.4" {...line} strokeWidth="2.2" />,
  cancelled: <path d="M4.8 11.2l6.4-6.4" {...line} strokeWidth="2" />,
};
/** a run's state as a tiny icon (building spins) */
export function BuildState({ status }: { status: BuildStatus }) {
  return (
    <svg className={`prsi bs-${status}`} width="15" height="15" viewBox="0 0 16 16" role="img" aria-label={BUILD_LABELS[status]}>
      <title>{BUILD_LABELS[status]}</title>
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <g style={{ color: 'var(--surface)' }} transform="translate(8 8) scale(.66) translate(-8 -8)">
        <g className={status === 'building' ? 'spin' : undefined}>{BGLYPH[status]}</g>
      </g>
    </svg>
  );
}
/** a pipeline run link shown as `◇ Project #123 [state]` */
export function BuildRef({ url, base, project, id }: { url: string; base: string; project: string; id: string }) {
  const s = useS();
  const ref = `devops:build/${base}#${id}`;
  const st = buildStatusOf(s.snaps, ref);
  const sn = s.snaps[ref];
  // a project in the url may be its id (a GUID): no use as a label
  const name = sn && !sn.gone ? sn.name : `${/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(project) ? 'run' : project} #${id}`;
  const why = st ? BUILD_LABELS[st] : sourceOn(s, 'devops') && !sn ? 'not followed: only links on an open item’s first line are' : 'state not known';
  return (
    <span className={`pr bs-${st ?? 'unknown'}`}>
      <span className="ado">◇</span>
      <a href={url} target="_blank" rel="noreferrer" title={`${name} — ${why} — ⌘-click opens it in the browser`} onClick={(e) => e.stopPropagation()}>
        {name}
      </a>
      {st ? <BuildState status={st} /> : <NoState s={s} plugin="devops" snap={sn} />}
    </span>
  );
}

/**
 * a PR link shown as `[mark] repo#123 [state]`. The mark, the name and the state are one no-wrap group,
 * so a narrow row never strands the icon on a line of its own.
 */
export function PrRef({ url, org, repo, num, icon = true }: { url: string; org: string; repo: string; num: string; icon?: boolean }) {
  const s = useS();
  const key = `${org}/${repo}#${num}`;
  const st = prStatusOf(s.snaps, key);
  return (
    <span className={`pr pr-${st ?? 'unknown'}`}>
      {icon && <GhIcon />}
      <a href={url} target="_blank" rel="noreferrer" title={`${org}/${repo} #${num} — ⌘-click opens it in the browser`} onClick={(e) => e.stopPropagation()}>
        {repo}#{num}
      </a>
      {st ? <PrState status={st} comments={prCountOf(s.snaps, key)} turn={prTurnOf(s.snaps, key)} /> : <NoState s={s} plugin="github" snap={s.snaps[`github:${key}`]} />}
    </span>
  );
}
