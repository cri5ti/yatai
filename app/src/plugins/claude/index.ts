/**
 * Claude Code sessions on this PC (CLI, VS Code, any number of windows). Pick the ones you care about in the Claude
 * drawer: each comes in as an item in Next that follows its session — working, needs you (a question or a permission),
 * finished — and speaks up when that changes. The state is read from the small files Claude Code keeps for each running
 * session (`~/.claude/sessions`, by src-tauri/src/claude.rs): no hooks, no changes to Claude Code, no transcripts.
 */
import { get } from '../../store';
import { claudeSessions, isTauri } from '../../platform';
import type { Impl, Plugin } from '../types';
import { endedSnapshot, entriesOf, idOf, snapshotOf } from './map';
import type { Session } from './map';
import { mock } from './mock';

const LISTS = [{ id: 'sessions', label: 'Sessions' }];

const live: Impl = {
  lists: LISTS,
  async list() {
    return entriesOf(await claudeSessions(), Date.now());
  },
  async fetch(refs) {
    const all = await claudeSessions();
    const by = new Map<string, Session>(all.map((s) => [s.sessionId, s]));
    return refs.map((ref) => {
      const s = by.get(idOf(ref));
      return s?.alive ? snapshotOf(s) : endedSnapshot(ref, get().snaps[ref]);
    });
  },
};

export const claude: Plugin = {
  id: 'claude',
  name: 'Claude',
  live: isTauri ? live : undefined,
  mock,
  pollMs: { active: 10_000, idle: 60_000 },
};
