import { prLinks } from '../../model';
import { isTauri } from '../../platform';
import { refKey } from '../types';
import type { Plugin } from '../types';
import { LISTS, connect, disconnect, fetchPrs, listPrs, status, whoAmI } from './api';
import { mock } from './mock';

/** GitHub (or GitHub Enterprise): pull requests. Live needs a token in Settings; the mock is the developer panel's. */
export const github: Plugin = {
  id: 'github',
  name: 'GitHub',
  auth: { configured: async () => (await status()).configured, who: whoAmI, connect, disconnect: async () => void (await disconnect()) },
  match: (text) => prLinks(text).map((l) => refKey('github', l.key)),
  live: isTauri ? { fetch: fetchPrs, lists: LISTS, list: listPrs } : undefined,
  mock,
  pollMs: { active: 60_000, idle: 180_000 },
};
