/** AI sessions (Claude / Copilot). Mock for now: no drawer, just the developer panel's scenarios. */
import { get } from '../store';
import type { Impl, Plugin, Snapshot } from './types';

const mock: Impl = {
  async fetch(refs) {
    const f = get().flags;
    return refs.map((ref): Snapshot => {
      const alert = f.aiNeedsFeedback
        ? ({ key: 'ai:feedback', tone: 'warn', text: 'Claude needs feedback', toast: 'Claude session is waiting for your input' } as const)
        : f.aiDone
          ? ({ key: 'ai:done', tone: 'good', text: 'Session finished', toast: 'Claude session finished: 14 files changed' } as const)
          : ({ key: 'ai:working', tone: 'info', text: 'Claude working…' } as const);
      return { ref, name: 'Claude', title: 'Claude session', view: { glyph: 'ai', label: alert.text, tone: alert.tone }, alerts: [alert], rev: alert.key };
    });
  },
};

export const ai: Plugin = { id: 'ai', name: 'AI sessions', mock, pollMs: { active: 30_000, idle: 120_000 } };
