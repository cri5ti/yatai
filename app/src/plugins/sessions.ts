/**
 * What the AI-session sources (Claude, Copilot) have in common: a session is working, needs you, finished or ended, and
 * becomes a snapshot (the chip and toast) or a drawer row. Pure: no app state, testable without a window.
 */
import type { Entry, Snapshot, View } from './types';

export type SessionGlyph = 'working' | 'waiting' | 'idle' | 'ended';
export const SESSION_LABELS: Record<SessionGlyph, string> = { working: 'working', waiting: 'needs you', idle: 'finished', ended: 'ended' };

/** a session of any source, as the page needs it */
export interface Item {
  id: string;
  name: string;
  cwd: string;
  where: string; // 'VS Code', 'terminal'…
  glyph: SessionGlyph;
  at: number; // when it got into that state
  waitingFor?: string | null;
}

const folder = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
export function ago(ms: number, now: number) {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
}

/** the state of a session: the glyph and chip. Each time it waits or finishes is a new alert (the key has its time), so a second one toasts again. */
export function snapshotOf(brand: string, plugin: string, it: Item): Snapshot {
  const g = it.glyph;
  const named = `${brand} ${it.name}`;
  const why = it.waitingFor && it.waitingFor !== 'input needed' ? it.waitingFor : '';
  const view: View = { glyph: g, label: SESSION_LABELS[g], tone: g === 'waiting' ? 'warn' : g === 'idle' ? 'good' : 'info', quiet: g === 'working' || g === 'ended' };
  const alert =
    g === 'waiting'
      ? ({ key: `${plugin}:waiting:${it.at}`, tone: 'warn', text: why ? `Needs you: ${why}` : 'Needs you', toast: `${named} needs you${why ? ` (${why})` : ''}` } as const)
      : g === 'idle'
        ? ({ key: `${plugin}:idle:${it.at}`, tone: 'good', text: 'Finished', toast: `${named} finished` } as const)
        : g === 'ended'
          ? ({ key: `${plugin}:ended`, tone: 'info', text: 'Session ended' } as const)
          : ({ key: `${plugin}:working`, tone: 'info', text: 'Working…' } as const);
  return { ref: `${plugin}:${it.id}`, name: named, title: `${brand}: ${it.name}`, view, alerts: [alert], rev: `${g}|${it.at}|${it.waitingFor ?? ''}|${it.name}` };
}

/** a tracked session that is not among the open ones any more (closed, or its window quit) */
export function endedSnapshot(brand: string, plugin: string, ref: string, prev?: Snapshot): Snapshot {
  const id = ref.slice(plugin.length + 1);
  const name = prev?.name.startsWith(brand + ' ') ? prev.name.slice(brand.length + 1) : id.slice(0, 8);
  return snapshotOf(brand, plugin, { id, name, cwd: '', where: '', glyph: 'ended', at: 0 });
}

const ORDER: Record<SessionGlyph, number> = { waiting: 0, working: 1, idle: 2, ended: 3 };

/** the drawer's rows: the sessions open now, those that need you first */
export function entriesOf(brand: string, plugin: string, items: Item[], now: number): Entry[] {
  return items
    .filter((i) => i.glyph !== 'ended')
    .sort((a, b) => ORDER[a.glyph] - ORDER[b.glyph] || b.at - a.at)
    .map((i): Entry => {
      const snap = snapshotOf(brand, plugin, i);
      return {
        ref: snap.ref,
        title: i.name,
        sub: [folder(i.cwd), i.where, `${SESSION_LABELS[i.glyph]} ${ago(i.at, now)}`].filter(Boolean).join(' · '),
        lead: { glyph: i.glyph, kind: plugin as 'claude' | 'copilot' },
        text: `${brand}: ${i.name}`,
        snap,
        smart: 'ai',
        canInbox: false,
      };
    });
}
