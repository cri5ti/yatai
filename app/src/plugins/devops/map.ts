/** Azure DevOps → what yatai shows. Pure: REST shapes in, snapshots out (testable without a network). */
import type { BuildStatus } from '../../store';
import type { Alert, Entry, Snapshot, Tone } from '../types';
import { buildUrl, relTime } from '../../model';

export const BUILD_LABELS: Record<BuildStatus, string> = { queued: 'queued', building: 'building', failed: 'failed', done: 'done', cancelled: 'cancelled' };
const TONES: Record<BuildStatus, Tone> = { queued: 'info', building: 'info', failed: 'bad', done: 'good', cancelled: 'info' };

/** the parts of GET …/_apis/build/builds/{id} that matter */
export interface AdoBuild {
  id: number;
  buildNumber: string;
  status: 'none' | 'notStarted' | 'inProgress' | 'cancelling' | 'postponed' | 'completed' | 'all';
  result?: 'none' | 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled';
  definition?: { name: string };
  sourceBranch?: string;
  project?: { name: string };
  requestedFor?: { displayName: string };
  queueTime?: string;
  startTime?: string;
}

export function statusOf(b: Pick<AdoBuild, 'status' | 'result'>): BuildStatus {
  if (b.status === 'completed') return b.result === 'failed' ? 'failed' : b.result === 'canceled' ? 'cancelled' : 'done';
  if (b.status === 'inProgress' || b.status === 'cancelling') return 'building';
  return 'queued';
}

/**
 * One snapshot for a run. Queued / building are passing states (quiet): only an item that asks to be notified hears
 * about them. Failed is an alert (toast + highlight); done is announced by its change of state.
 */
export function buildSnapshot(ref: string, name: string, title: string, st: BuildStatus, opts: { partial?: boolean; detail?: string } = {}): Snapshot {
  const alerts: Alert[] = [];
  if (st === 'failed') alerts.push({ key: 'run:failed', tone: 'bad', text: opts.detail ? `Failed: ${opts.detail}` : 'Run failed', toast: `${name} failed${opts.detail ? `: ${opts.detail}` : ''}` });
  else if (st === 'done' && opts.partial) alerts.push({ key: 'run:partial', tone: 'warn', text: 'Partially succeeded', toast: `${name} partially succeeded` });
  else alerts.push({ key: `run:${st}`, tone: 'info', text: st === 'building' && opts.detail ? `Building · ${opts.detail}` : BUILD_LABELS[st][0].toUpperCase() + BUILD_LABELS[st].slice(1) });
  const view = { glyph: st, label: BUILD_LABELS[st], tone: TONES[st], ...(st === 'queued' || st === 'building' ? { quiet: true } : {}) };
  return { ref, name, title, view, alerts, rev: JSON.stringify([st, alerts.map((a) => a.key), title]) };
}

const short = (branch?: string) => branch?.replace(/^refs\/heads\//, '');
export const toSnapshot = (ref: string, b: AdoBuild): Snapshot => {
  const def = b.definition?.name ?? 'Pipeline';
  return buildSnapshot(ref, `${def} #${b.id}`, `${def} ${b.buildNumber}${b.sourceBranch ? ` (${short(b.sourceBranch)})` : ''}`, statusOf(b), { partial: b.result === 'partiallySucceeded' });
};

/** a row of the Pipelines drawer list: `base` is <host>/<org>/<project as in a url>, so the ref matches a pasted link */
export function entryOf(base: string, b: AdoBuild): Entry {
  const ref = `devops:build/${base}#${b.id}`;
  const snap = toSnapshot(ref, b);
  const st = statusOf(b);
  const when = st === 'building' && b.startTime ? `started ${relTime(Date.parse(b.startTime))}` : b.queueTime ? `queued ${relTime(Date.parse(b.queueTime))}` : '';
  const who = b.requestedFor?.displayName;
  return {
    ref,
    title: `${b.definition?.name ?? 'Pipeline'} ${b.buildNumber}`,
    sub: [b.project?.name ?? decodeURIComponent(base.split('/').pop() ?? ''), short(b.sourceBranch), who, when].filter(Boolean).join(' · '),
    lead: { glyph: st, kind: 'build' },
    text: `${buildUrl(base, String(b.id))} ${b.definition?.name ?? 'Pipeline'} ${b.buildNumber}`,
    snap,
    canInbox: true,
  };
}
/** running first, then waiting; the most recent first within each */
export const byRunning = (a: AdoBuild, b: AdoBuild) =>
  (statusOf(a) === 'building' ? 0 : 1) - (statusOf(b) === 'building' ? 0 : 1) ||
  Date.parse(b.startTime ?? b.queueTime ?? '') - Date.parse(a.startTime ?? a.queueTime ?? '');
