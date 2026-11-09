/** the developer panel's GitHub: statuses come from state.prs / state.prc, the lists from mock.ts */
import { get } from '../../store';
import type { PrStatus } from '../../store';
import { GH } from '../../mock';
import { DEFAULT_COMMENTS } from '../../Pr';
import { prUrl } from '../../model';
import { refKey } from '../types';
import type { Entry, Impl, Snapshot } from '../types';
import { LISTS } from './api';
import { noFacts, snapshot } from './map';
import type { Facts } from './map';

const SAY = [
  'Can we rename this to something clearer?',
  'This needs a test for the empty case.',
  'Why not reuse the existing helper here?',
  'Typo in the error message.',
  'Should this be behind the feature flag?',
];
const FILES = ['export.ts', 'staff.ts', 'export.test.ts', 'api.ts', 'flags.ts'];
const factsFor = (status: PrStatus, count: number, key = ''): Facts => ({
  ...noFacts,
  draft: status === 'draft',
  merged: status === 'merged',
  closed: status === 'closed',
  failing: status === 'failing' ? 'unit-tests' : null,
  fails: status === 'failing' ? [{ name: 'unit-tests', error: 'StaffExport › exports every column: expected 12 columns, got 11 (export.test.ts:41)', url: `https://github.com/${key.split('#')[0]}/actions/runs/9100${key.split('#')[1] ?? ''}` }] : [],
  // threads t0…t(n-1): lowering the count in the developer panel resolves the last ones
  open: status === 'feedback' ? Array.from({ length: count }, (_, i) => ({ id: `t${i}`, author: ['priya', 'sam', 'lee'][i % 3], body: SAY[i % SAY.length], path: `src/${FILES[i % FILES.length]}`, url: `https://github.com/${key.split('#')[0]}/pull/${key.split('#')[1]}#discussion_r${1000 + i}` })) : [],
  oid: 'abc1234',
  pending: status === 'building',
  checksOk: status !== 'building',
  threads: status === 'feedback' ? count : 0,
  approved: status === 'ready',
});

const snapOf = (key: string, title: string, status: PrStatus, count: number): Snapshot =>
  snapshot(refKey('github', key), key.replace(/^[^/]+\//, ''), title, factsFor(status, count, key));

export const mock: Impl = {
  async fetch(refs) {
    const s = get();
    return refs.map((ref) => {
      const key = ref.slice('github:'.length);
      const title = Object.values(GH).flat().find((g) => `${g.org}/${g.repo}#${g.num}` === key)?.title ?? key;
      return snapOf(key, title, s.prs[key] ?? 'review', s.prc[key] ?? DEFAULT_COMMENTS);
    });
  },
  lists: LISTS,
  async list(id) {
    const s = get();
    return (GH[id] ?? []).map((g): Entry => {
      const key = `${g.org}/${g.repo}#${g.num}`;
      const snap = snapOf(key, g.title, s.prs[key] ?? g.status, s.prc[key] ?? g.comments ?? DEFAULT_COMMENTS);
      return { ref: snap.ref, title: g.title, sub: `${g.org} · ${g.note}`, lead: { glyph: snap.view.glyph, count: snap.view.count }, text: `${prUrl(g.org, g.repo, g.num)} ${g.title}`, snap, canInbox: true };
    });
  },
};
