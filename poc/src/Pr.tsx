import { useS } from './store';
import type { PrStatus } from './store';

export const PR_STATUSES: { id: PrStatus; label: string }[] = [
  { id: 'draft', label: 'draft' },
  { id: 'review', label: 'to review' },
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
  feedback: null,
  failing: (
    <>
      {ring}
      <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" {...line} />
    </>
  ),
  ready: (
    <>
      {ring}
      <path d="M5.2 8.4l2 2 3.7-4.2" {...line} />
    </>
  ),
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

/** a PR's state as a tiny icon — or, for "has feedback", a count pill of unresolved comments */
export function PrState({ status, comments = DEFAULT_COMMENTS }: { status: PrStatus; comments?: number }) {
  if (status === 'feedback') {
    const n = Math.max(1, comments);
    return (
      <span className="prc" title={`has feedback — ${n} unresolved comment${n === 1 ? '' : 's'}`} aria-label={`${n} unresolved comments`}>
        {n}
      </span>
    );
  }
  return (
    <svg className={`prsi pr-${status}`} width="11" height="11" viewBox="0 0 16 16" role="img" aria-label={prLabel(status)}>
      <title>{prLabel(status)}</title>
      {GLYPH[status]}
    </svg>
  );
}

/**
 * a PR link shown as `[mark] repo#123 [state]`. The mark, the name and the state are one no-wrap group,
 * so a narrow row never strands the icon on a line of its own.
 */
export function PrRef({ url, org, repo, num, icon = true }: { url: string; org: string; repo: string; num: string; icon?: boolean }) {
  const s = useS();
  const key = `${org}/${repo}#${num}`;
  const st: PrStatus = s.prs[key] ?? 'review';
  return (
    <span className={`pr pr-${st}`}>
      {icon && <GhIcon />}
      <a href={url} target="_blank" rel="noreferrer" title={`${org}/${repo} #${num}`} onClick={(e) => e.stopPropagation()}>
        {repo}#{num}
      </a>
      <PrState status={st} comments={s.prc[key]} />
    </span>
  );
}
