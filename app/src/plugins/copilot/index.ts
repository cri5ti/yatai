/**
 * GitHub Copilot sessions on this PC (CLI, VS Code, JetBrains). Same idea as the Claude drawer: pick the ones you care
 * about, they become items in Next that say working / needs you / finished. The state comes from Copilot's own session
 * folders (`~/.copilot/session-state`, read by src-tauri/src/copilot.rs): the kind of the last events, never the conversation.
 */
import { get } from '../../store';
import { copilotSessions, isTauri } from '../../platform';
import type { Impl, Plugin } from '../types';
import { endedSnapshot, entriesOf, idOf, snapshotOf } from './map';
import { mock } from './mock';

const live: Impl = {
  lists: [{ id: 'sessions', label: 'Sessions' }],
  async list() {
    return entriesOf(await copilotSessions(), Date.now());
  },
  async fetch(refs) {
    const by = new Map((await copilotSessions()).map((s) => [s.sessionId, s]));
    return refs.map((ref) => {
      const s = by.get(idOf(ref));
      return s && s.state !== 'ended' ? snapshotOf(s) : endedSnapshot(ref, get().snaps[ref]);
    });
  },
};

export const copilot: Plugin = {
  id: 'copilot',
  name: 'Copilot',
  live: isTauri ? live : undefined,
  mock,
  pollMs: { active: 10_000, idle: 60_000 },
};
