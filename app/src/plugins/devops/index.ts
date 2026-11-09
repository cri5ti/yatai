import { buildLinks } from '../../model';
import { isTauri } from '../../platform';
import type { Plugin } from '../types';
import { LISTS, configured, connect, disconnect, fetchBuilds, listPipelines, whoAmI } from './api';
import { mock } from './mock';

/**
 * Azure DevOps: pipeline runs (builds) pasted as links, tracked live with a personal access token, and the Pipelines
 * drawer list (every run going or waiting); work items are mocked for now (the developer panel's).
 */
export const devops: Plugin = {
  id: 'devops',
  name: 'DevOps',
  auth: {
    field: { label: 'Personal access token', placeholder: 'Azure DevOps PAT', help: 'Build (Read) scope, for the organization above.' },
    configured, who: whoAmI, connect, disconnect,
  },
  match: (text) => buildLinks(text).map((l) => `devops:build/${l.key}`),
  live: isTauri ? { fetch: fetchBuilds, lists: LISTS, list: async (id) => (id === 'pipelines' ? listPipelines() : []) } : undefined,
  mock,
  pollMs: { active: 30_000, idle: 180_000 },
};
