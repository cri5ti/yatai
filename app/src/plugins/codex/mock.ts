/** the demo connectors' Codex sessions: made up, one in each state */
import type { Impl } from '../types';
import { endedSnapshot, entriesOf, idOf, snapshotOf } from './map';
import type { Session } from './map';

const at = (min: number) => Date.now() - min * 60_000;
const sessions = (): Session[] => [
  { sessionId: 'demo-cx-1', cwd: 'd:\\work\\payments', name: 'Add retry to the payment client', client: 'vscode-agent-host', branch: 'main', state: 'waiting', stateAt: at(3) },
  { sessionId: 'demo-cx-2', cwd: 'd:\\work\\payments', name: 'Explain the ledger tests', client: 'github/cli', branch: 'main', state: 'working', stateAt: at(1) },
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
