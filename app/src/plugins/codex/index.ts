import { get } from '../../store';
import { codexSessions, isTauri } from '../../platform';
import type { Impl, Plugin } from '../types';
import { endedSnapshot, entriesOf, idOf, snapshotOf } from './map';
import { mock } from './mock';
import { setQuotas } from '../requests';

async function sessions() {
  const report = await codexSessions();
  if (!get().demo && get().settings.sources?.codex?.on !== false) setQuotas('codex', report.quotas);
  return report.sessions;
}

const live: Impl = {
  lists: [{ id: 'sessions', label: 'Sessions' }],
  async list() {
    return entriesOf(await sessions(), Date.now());
  },
  async fetch(refs) {
    const by = new Map((await sessions()).map((s) => [s.sessionId, s]));
    return refs.map((ref) => {
      const s = by.get(idOf(ref));
      return s && s.state !== 'ended' ? snapshotOf(s) : endedSnapshot(ref, get().snaps[ref]);
    });
  },
};

export const codex: Plugin = {
  id: 'codex',
  name: 'Codex',
  watch: ['sessions'],
  live: isTauri ? live : undefined,
  mock,
  pollMs: { active: 10_000, idle: 60_000 },
};
