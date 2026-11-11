/** Claude Code sessions → what yatai shows. Pure: session files in, snapshots and drawer rows out (testable without the app). */
import type { Entry, Snapshot, View } from '../types';

/** what src-tauri/src/claude.rs returns for one running session */
export interface Session {
  sessionId: string;
  pid: number;
  cwd: string;
  name: string;
  status: string; // 'busy' | 'idle' | 'waiting' | 'shell'
  waitingFor?: string | null;
  entrypoint: string;
  startedAt: number;
  statusAt: number;
  alive: boolean;
}

export type ClaudeGlyph = 'working' | 'waiting' | 'idle' | 'ended';
export const CLAUDE_LABELS: Record<ClaudeGlyph, string> = { working: 'working', waiting: 'needs you', idle: 'finished', ended: 'ended' };

export const refOf = (sessionId: string) => `claude:${sessionId}`;
export const idOf = (ref: string) => ref.slice('claude:'.length);

export function glyphOf(s: Pick<Session, 'status' | 'alive'>): ClaudeGlyph {
  if (!s.alive) return 'ended';
  if (s.status === 'waiting') return 'waiting';
  if (s.status === 'idle') return 'idle';
  return 'working'; // busy, or running a shell command
}

const folder = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
const where = (e: string) => (e === 'claude-vscode' ? 'VS Code' : e === 'cli' ? 'terminal' : e || 'Claude');
export function ago(ms: number, now: number) {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
}

/** the state of a session: the glyph and chip. Each time it waits or finishes is a new alert (the key has its time), so a second one toasts again. */
export function snapshotOf(s: Session): Snapshot {
  const g = glyphOf(s);
  const ref = refOf(s.sessionId);
  const at = s.statusAt;
  const view: View = { glyph: g, label: CLAUDE_LABELS[g], tone: g === 'waiting' ? 'warn' : g === 'idle' ? 'good' : 'info', quiet: g === 'working' || g === 'ended' };
  const alert =
    g === 'waiting'
      ? ({ key: `claude:waiting:${at}`, tone: 'warn', text: s.waitingFor && s.waitingFor !== 'input needed' ? `Needs you: ${s.waitingFor}` : 'Needs you', toast: `Claude ${s.name} needs you${s.waitingFor && s.waitingFor !== 'input needed' ? ` (${s.waitingFor})` : ''}` } as const)
      : g === 'idle'
        ? ({ key: `claude:idle:${at}`, tone: 'good', text: 'Finished', toast: `Claude ${s.name} finished` } as const)
        : g === 'ended'
          ? ({ key: 'claude:ended', tone: 'info', text: 'Session ended' } as const)
          : ({ key: 'claude:working', tone: 'info', text: 'Working…' } as const);
  return { ref, name: `Claude ${s.name}`, title: `Claude: ${s.name}`, view, alerts: [alert], rev: `${g}|${at}|${s.waitingFor ?? ''}|${s.name}` };
}

/** a tracked session that is not among the running ones any more (closed, or its window quit) */
export function endedSnapshot(ref: string, prev?: Snapshot): Snapshot {
  const name = prev?.name.replace(/^Claude /, '') ?? idOf(ref).slice(0, 8);
  return snapshotOf({ sessionId: idOf(ref), pid: 0, cwd: '', name, status: 'idle', entrypoint: '', startedAt: 0, statusAt: 0, alive: false });
}

const ORDER: Record<ClaudeGlyph, number> = { waiting: 0, working: 1, idle: 2, ended: 3 };

/** the drawer's rows: the sessions running now, those that need you first */
export function entriesOf(sessions: Session[], now: number): Entry[] {
  return sessions
    .filter((s) => s.alive)
    .sort((a, b) => ORDER[glyphOf(a)] - ORDER[glyphOf(b)] || b.statusAt - a.statusAt)
    .map((s): Entry => {
      const snap = snapshotOf(s);
      const g = glyphOf(s);
      return {
        ref: snap.ref,
        title: s.name,
        sub: [folder(s.cwd), where(s.entrypoint), `${CLAUDE_LABELS[g]} ${ago(s.statusAt, now)}`].filter(Boolean).join(' · '),
        lead: { glyph: g, kind: 'claude' },
        text: `Claude: ${s.name}`,
        snap,
        smart: 'ai',
        canInbox: false,
      };
    });
}
