/** Azure DevOps: work items and pipeline runs. Mock for now (the developer panel's scenarios). */
import { get } from '../store';
import { ADO } from '../mock';
import type { Entry, Impl, Plugin, Snapshot } from './types';

const snap = (ref: string, name: string, title: string, label: string, alerts: Snapshot['alerts']): Snapshot => ({
  ref,
  name,
  title,
  view: { glyph: 'item', label, tone: alerts[0]?.tone ?? 'info' },
  alerts,
  rev: JSON.stringify([label, alerts.map((a) => a.key)]),
});

const mock: Impl = {
  async fetch(refs) {
    const f = get().flags;
    return refs.flatMap((ref): Snapshot[] => {
      if (ref.startsWith('devops:run/')) {
        return [
          snap(ref, 'Deploy', 'Deploy 2.4 to prod', f.pipelineFailed ? 'failed' : 'running', [
            f.pipelineFailed ? { key: 'run:failed', tone: 'bad', text: 'Deploy failed at "prod-eu"', toast: 'Deploy 2.4 failed at prod-eu' } : { key: 'run:going', tone: 'info', text: 'Deploying · stage 2/4' },
          ]),
        ];
      }
      if (ref.startsWith('devops:wi/')) {
        const id = ref.slice('devops:wi/'.length);
        return [
          snap(ref, `WI ${id}`, `WI ${id}`, f.workItemChanged ? 'Resolved' : 'Active', [
            f.workItemChanged ? { key: 'wi:resolved', tone: 'warn', text: 'State: Active → Resolved', toast: `WI ${id} moved to Resolved` } : { key: 'wi:active', tone: 'info', text: 'Active' },
          ]),
        ];
      }
      return [];
    });
  },
  lists: [
    { id: 'mentions', label: 'Mentions' },
    { id: 'mine', label: 'My work items' },
    { id: 'created', label: 'Created by me' },
  ],
  async list(id) {
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

export const devops: Plugin = { id: 'devops', name: 'DevOps', mock, pollMs: { active: 60_000, idle: 300_000 } };
