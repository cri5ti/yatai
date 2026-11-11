/** the demo connectors' Claude sessions: made up, one in each state */
import type { Impl } from '../types';
import { endedSnapshot, entriesOf, idOf, snapshotOf } from './map';
import type { Session } from './map';

const at = (min: number) => Date.now() - min * 60_000;
const sessions = (): Session[] => [
  { sessionId: 'demo-api', pid: 1, cwd: 'd:\\work\\billing-api', name: 'billing-api-3f', status: 'waiting', waitingFor: 'input needed', entrypoint: 'claude-vscode', startedAt: at(95), statusAt: at(4), alive: true },
  { sessionId: 'demo-web', pid: 2, cwd: 'd:\\work\\web', name: 'web-a1', status: 'busy', entrypoint: 'cli', startedAt: at(40), statusAt: at(1), alive: true },
  { sessionId: 'demo-docs', pid: 3, cwd: 'd:\\work\\docs', name: 'docs-9c', status: 'idle', entrypoint: 'claude-vscode', startedAt: at(200), statusAt: at(22), alive: true },
];

export const mock: Impl = {
  lists: [{ id: 'sessions', label: 'Sessions' }],
  async list() {
    return entriesOf(sessions(), Date.now());
  },
  async fetch(refs) {
    const all = sessions();
    return refs.map((ref) => {
      const s = all.find((x) => x.sessionId === idOf(ref));
      return s ? snapshotOf(s) : endedSnapshot(ref);
    });
  },
};
