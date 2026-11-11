/** Azure DevOps → what yatai shows. Pure: REST shapes in, snapshots out (testable without a network). */
import type { BuildStatus } from '../../store';
import type { Alert, Entry, Snapshot, Tone, View } from '../types';
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
  finishTime?: string;
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
  const view: View = { glyph: st, label: BUILD_LABELS[st], tone: TONES[st], ...(st === 'queued' || st === 'building' ? { quiet: true, turn: 'them' as const } : st === 'failed' ? { turn: 'me' as const } : {}) };
  return { ref, name, title, view, alerts, rev: JSON.stringify([st, view.turn, alerts.map((a) => a.key), title]) };
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
  const when =
    b.finishTime && b.status === 'completed'
      ? `finished ${relTime(Date.parse(b.finishTime))}`
      : st === 'building' && b.startTime
        ? `started ${relTime(Date.parse(b.startTime))}`
        : b.queueTime
          ? `queued ${relTime(Date.parse(b.queueTime))}`
          : '';
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

/* ---------- work items ---------- */
/** the fields asked for every work item */
export const WI_FIELDS = ['System.Id', 'System.Title', 'System.WorkItemType', 'System.State', 'System.TeamProject', 'System.ChangedDate', 'System.AssignedTo'];
export interface AdoWorkItem {
  id: number;
  fields: Record<string, unknown>;
}
const str = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' && 'displayName' in v ? String((v as { displayName: unknown }).displayName) : '');

/** a tracked work item: its state is the glyph, so a change of state is announced (as info) */
export function wiSnapshot(ref: string, w: AdoWorkItem): Snapshot {
  const state = str(w.fields['System.State']) || '?';
  const title = str(w.fields['System.Title']);
  const name = `WI ${w.id}`;
  return {
    ref,
    name,
    title,
    view: { glyph: state, label: state, tone: 'info' },
    alerts: [{ key: `wi:${state}`, tone: 'info', text: state }],
    rev: JSON.stringify([state, title, str(w.fields['System.AssignedTo'])]),
  };
}
export function wiEntry(w: AdoWorkItem): Entry {
  const f = w.fields;
  const changed = str(f['System.ChangedDate']);
  return {
    ref: `devops:wi/${w.id}`,
    title: str(f['System.Title']),
    sub: [str(f['System.WorkItemType']), str(f['System.State']), str(f['System.TeamProject']), str(f['System.AssignedTo']), changed ? `changed ${relTime(Date.parse(changed))}` : ''].filter(Boolean).join(' · '),
    lead: { text: `WI ${w.id}` },
    text: `WI ${w.id} — ${str(f['System.Title'])}`,
    smart: 'workitem',
    snap: wiSnapshot(`devops:wi/${w.id}`, w),
    canInbox: true,
  };
}

/** the drawer's work-item lists, as WIQL (finished items left out where "what is on my plate" is meant) */
const OPEN = `[System.State] NOT IN ('Closed', 'Done', 'Removed', 'Completed', 'Cut')`;
export const WIQL: Record<string, string> = {
  mine: `SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND ${OPEN} ORDER BY [System.ChangedDate] DESC`,
  created: `SELECT [System.Id] FROM WorkItems WHERE [System.CreatedBy] = @Me AND ${OPEN} ORDER BY [System.ChangedDate] DESC`,
  following: `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (@Follows) ORDER BY [System.ChangedDate] DESC`,
  mentions: `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (@RecentMentions) ORDER BY [System.ChangedDate] DESC`,
};

/** the Builds lists: which runs (statusFilter) and in what order */
export const BUILD_LISTS: Record<string, { filter: string; order: string; today?: boolean; top: number }> = {
  pending: { filter: 'notStarted,postponed', order: 'queueTimeDescending', top: 50 },
  running: { filter: 'inProgress,cancelling', order: 'startTimeDescending', top: 50 },
  recent: { filter: 'completed', order: 'finishTimeDescending', today: true, top: 20 },
};
/** newest first, by the time that matters for the list */
export const byNewest = (a: AdoBuild, b: AdoBuild) =>
  Date.parse(b.finishTime ?? b.startTime ?? b.queueTime ?? '') - Date.parse(a.finishTime ?? a.startTime ?? a.queueTime ?? '');
