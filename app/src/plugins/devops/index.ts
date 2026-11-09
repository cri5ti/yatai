import { buildLinks } from '../../model';
import { isTauri } from '../../platform';
import type { Plugin } from '../types';
import { LISTS, configured, connect, disconnect, fetchAll, listPipelines, listWorkItems, whoAmI } from './api';
import { mock } from './mock';

/**
 * Azure DevOps, live with a personal access token: pipeline runs (pasted links, and the Pipelines list of every run going
 * or waiting) and work items (Assigned to me, Created by me, Following, Mentions; brought in as smart items whose state
 * is followed). The developer panel's mock does the same with made-up data.
 */
export const devops: Plugin = {
  id: 'devops',
  name: 'DevOps',
  auth: {
    field: { label: 'Personal access token', placeholder: 'Azure DevOps PAT', help: 'Build (Read) and Work Items (Read) scopes, for the organization above.' },
    configured, who: whoAmI, connect, disconnect,
  },
  match: (text) => buildLinks(text).map((l) => `devops:build/${l.key}`),
  live: isTauri ? { fetch: fetchAll, lists: LISTS, list: (id) => (id === 'pipelines' ? listPipelines() : listWorkItems(id)) } : undefined,
  mock,
  pollMs: { active: 30_000, idle: 180_000 },
};
