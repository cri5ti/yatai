import { buildLinks } from '../../model';
import { isTauri } from '../../platform';
import type { Plugin } from '../types';
import { configured, connect, disconnect, fetchBuilds, whoAmI } from './api';
import { mock } from './mock';

/**
 * Azure DevOps: pipeline runs (builds) pasted as links, tracked live with a personal access token; work items and the
 * drawer lists are mocked for now (the developer panel's).
 */
export const devops: Plugin = {
  id: 'devops',
  name: 'DevOps',
  auth: {
    field: { label: 'Personal access token', placeholder: 'Azure DevOps PAT', help: 'A token with Build (Read) scope for the organization above is enough.' },
    configured, who: whoAmI, connect, disconnect,
  },
  match: (text) => buildLinks(text).map((l) => `devops:build/${l.key}`),
  live: isTauri ? { fetch: fetchBuilds } : undefined,
  mock,
  pollMs: { active: 30_000, idle: 180_000 },
};
