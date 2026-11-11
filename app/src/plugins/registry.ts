import { isTauri } from '../platform';
import type { State } from '../store';
import { ai } from './ai';
import { claude } from './claude';
import { copilot } from './copilot';
import { devops } from './devops';
import { github } from './github';
import { mail } from './mail';
import { outlook } from './outlook';
import type { Impl, Plugin } from './types';

/** every source yatai knows. Adding one: a file in plugins/, one line here. */
export const PLUGINS: Plugin[] = [github, outlook, devops, mail, claude, copilot, ai];
export const pluginById = (id: string) => PLUGINS.find((p) => p.id === id);

/**
 * Which implementation is on for a plugin: the mock when the developer panel's demo connectors are on; else the real one when
 * it can run (desktop app, and connected when it needs an account); else none.
 */
export function implFor(p: Plugin, s: Pick<State, 'demo' | 'accounts'>): Impl | null {
  if (s.demo && p.mock) return p.mock;
  if (p.live && isTauri && (!p.auth || s.accounts[p.id]?.state === 'connected')) return p.live;
  return null;
}
export const isLive = (p: Plugin, s: Pick<State, 'demo' | 'accounts'>) => !!p.live && implFor(p, s) === p.live;
