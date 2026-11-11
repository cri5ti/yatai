/** Claude Code sessions → what yatai shows (the shared part is in ../sessions.ts). Pure: session files in, snapshots and rows out. */
import type { Entry, Snapshot } from '../types';
import * as S from '../sessions';
import type { SessionGlyph } from '../sessions';

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

export type ClaudeGlyph = SessionGlyph;
export const CLAUDE_LABELS = S.SESSION_LABELS;
export const ago = S.ago;

const BRAND = 'Claude';
const PLUGIN = 'claude';
export const refOf = (sessionId: string) => `${PLUGIN}:${sessionId}`;
export const idOf = (ref: string) => ref.slice(PLUGIN.length + 1);

export function glyphOf(s: Pick<Session, 'status' | 'alive'>): SessionGlyph {
  if (!s.alive) return 'ended';
  if (s.status === 'waiting') return 'waiting';
  if (s.status === 'idle') return 'idle';
  return 'working'; // busy, or running a shell command
}

const where = (e: string) => (e === 'claude-vscode' ? 'VS Code' : e === 'cli' ? 'terminal' : e || 'Claude');
const item = (s: Session): S.Item => ({ id: s.sessionId, name: s.name, cwd: s.cwd, where: where(s.entrypoint), glyph: glyphOf(s), at: s.statusAt, waitingFor: s.waitingFor });

export const snapshotOf = (s: Session): Snapshot => S.snapshotOf(BRAND, PLUGIN, item(s));
export const endedSnapshot = (ref: string, prev?: Snapshot): Snapshot => S.endedSnapshot(BRAND, PLUGIN, ref, prev);
export const entriesOf = (sessions: Session[], now: number): Entry[] => S.entriesOf(BRAND, PLUGIN, sessions.filter((s) => s.alive).map(item), now);
