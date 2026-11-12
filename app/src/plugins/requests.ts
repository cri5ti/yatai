/** Request counts per plugin (each drawer shows them, to keep an eye on quotas). No imports of the plugins: they call it. */
import { set } from '../store';
import type { State } from '../store';

export function countRequest(plugin: string) {
  const now = Date.now();
  set((s) => {
    const r = s.reqs[plugin] ?? { at: [], total: 0 };
    return { reqs: { ...s.reqs, [plugin]: { ...r, at: [...r.at.filter((t) => t > now - 3_600_000), now], total: r.total + 1 } } };
  });
}
export function setQuota(plugin: string, quota: NonNullable<State['reqs'][string]['quota']>) {
  set((s) => ({ reqs: { ...s.reqs, [plugin]: { ...(s.reqs[plugin] ?? { at: [], total: 0 }), quota } } }));
}

/** Replace all reported windows, including clearing an unavailable reading. */
export function setQuotas(plugin: string, quotas: import('../store').Quota[]) {
  set((s) => ({ reqs: { ...s.reqs, [plugin]: { ...(s.reqs[plugin] ?? { at: [], total: 0 }), quota: undefined, quotas } } }));
}
