/** the developer panel's DevOps: work items follow the scenario flags; pipeline runs follow state.runs */
import { get } from '../../store';
import type { BuildStatus } from '../../store';
import { ADO, PIPELINES } from '../../mock';
import { buildUrl } from '../../model';
import type { Entry, Impl, Snapshot } from '../types';
import { buildSnapshot } from './map';
import { LISTS } from './api';

const wiSnap = (ref: string, name: string, label: string, alerts: Snapshot['alerts']): Snapshot => ({
  ref,
  name,
  title: name,
  view: { glyph: 'item', label, tone: alerts[0]?.tone ?? 'info' },
  alerts,
  rev: JSON.stringify([label, alerts.map((a) => a.key)]),
});

/** what a mocked run is: the developer panel's pick, else its list entry, else building */
export const mockRun = (ref: string): BuildStatus => {
  const s = get();
  if (s.runs[ref]) return s.runs[ref];
  if (ref === 'devops:run/deploy-2.4') return s.flags.pipelineFailed ? 'failed' : 'building';
  return PIPELINES.find((p) => `devops:build/${p.base}#${p.id}` === ref)?.status ?? 'building';
};

export const mock: Impl = {
  async fetch(refs) {
    const f = get().flags;
    return refs.flatMap((ref): Snapshot[] => {
      if (ref === 'devops:run/deploy-2.4' || ref.startsWith('devops:run/')) {
        const st = mockRun(ref);
        return [buildSnapshot(ref, 'Deploy 2.4', 'Deploy 2.4 to prod', st, { detail: st === 'failed' ? 'prod-eu' : st === 'building' ? 'stage 2/4' : undefined })];
      }
      if (ref.startsWith('devops:build/')) {
        const p = PIPELINES.find((x) => `devops:build/${x.base}#${x.id}` === ref);
        const name = p ? `${p.name} #${p.id}` : `run #${ref.split('#')[1]}`;
        return [buildSnapshot(ref, name, p ? `${p.name} ${p.number}` : name, mockRun(ref))];
      }
      if (ref.startsWith('devops:wi/')) {
        const id = ref.slice('devops:wi/'.length);
        return [
          wiSnap(ref, `WI ${id}`, f.workItemChanged ? 'Resolved' : 'Active', [
            f.workItemChanged ? { key: 'wi:resolved', tone: 'warn', text: 'State: Active → Resolved', toast: `WI ${id} moved to Resolved` } : { key: 'wi:active', tone: 'info', text: 'Active' },
          ]),
        ];
      }
      return [];
    });
  },
  lists: LISTS,
  async list(id) {
    const want: Record<string, string[]> = { pending: ['queued'], running: ['building'], recent: ['done', 'failed', 'cancelled'] };
    if (want[id])
      return PIPELINES.filter((p) => want[id].includes(mockRun(`devops:build/${p.base}#${p.id}`))).map((p): Entry => {
        const ref = `devops:build/${p.base}#${p.id}`;
        const snap = buildSnapshot(ref, `${p.name} #${p.id}`, `${p.name} ${p.number}`, mockRun(ref));
        return { ref, title: `${p.name} ${p.number}`, sub: `${p.base.split('/').pop()} · ${p.branch} · ${p.note}`, lead: { glyph: snap.view.glyph, kind: 'build' }, text: `${buildUrl(p.base, p.id)} ${p.name} ${p.number}`, snap, canInbox: true };
      });
    return (ADO[id] ?? []).map((w): Entry => ({
      ref: `devops:wi/${w.id}`,
      title: w.title,
      sub: `${w.type} · ${w.state} · ${w.note}`,
      lead: { text: `WI ${w.id}` },
      text: `WI ${w.id} — ${w.title}`,
      smart: 'workitem',
      canInbox: true,
    }));
  },
};
