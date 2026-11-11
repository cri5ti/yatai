/** GitHub Copilot sessions → what yatai shows (the shared part is in ../sessions.ts). */
import type { Entry, Snapshot } from '../types';
import * as S from '../sessions';
import type { SessionGlyph } from '../sessions';

/** what src-tauri/src/copilot.rs returns for one session */
export interface Session {
  sessionId: string;
  cwd: string;
  name: string;
  client: string; // 'vscode-agent-host' | 'github/cli' | 'copilot-intellij'
  branch: string;
  state: string; // 'working' | 'waiting' | 'idle' | 'ended'
  stateAt: number;
}

const BRAND = 'Copilot';
const PLUGIN = 'copilot';
/** sessions that finished longer ago than this are not offered (a long-lived VS Code runtime keeps old ones open) */
export const STALE_MS = 2 * 86_400_000;

export const idOf = (ref: string) => ref.slice(PLUGIN.length + 1);
const glyphOf = (s: Pick<Session, 'state'>): SessionGlyph => (s.state === 'working' || s.state === 'waiting' || s.state === 'idle' ? s.state : 'ended');
const where = (c: string) => (c.includes('vscode') ? 'VS Code' : c.includes('cli') ? 'terminal' : c.includes('intellij') ? 'IntelliJ' : c || 'Copilot');
const item = (s: Session): S.Item => ({ id: s.sessionId, name: s.name, cwd: s.cwd, where: where(s.client), glyph: glyphOf(s), at: s.stateAt });

export const snapshotOf = (s: Session): Snapshot => S.snapshotOf(BRAND, PLUGIN, item(s));
export const endedSnapshot = (ref: string, prev?: Snapshot): Snapshot => S.endedSnapshot(BRAND, PLUGIN, ref, prev);
/** open sessions, without the idle ones nobody has touched for days */
export const entriesOf = (sessions: Session[], now: number): Entry[] =>
  S.entriesOf(BRAND, PLUGIN, sessions.map(item).filter((i) => i.glyph !== 'idle' || now - i.at < STALE_MS), now);
