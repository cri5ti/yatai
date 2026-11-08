import { get } from '../../store';
import { normHost } from '../../model';
import { pluginHttp, pluginSecretSet, pluginSecretStatus } from '../../platform';
import { AuthError } from '../types';
import type { Entry, ListDef, Snapshot } from '../types';
import { PR_FIELDS, ago, prId, shortName, toSnapshot } from './map';
import type { GqlPr } from './map';
import { refKey } from '../types';

export const ID = 'github';

/** where the API is, for github.com or a GitHub Enterprise host. `host` is the one the token is bound to. */
export function endpoints(setting: string) {
  const h = normHost(setting);
  return h === 'github.com' ? { host: 'api.github.com', graphql: 'https://api.github.com/graphql' } : { host: h, graphql: `https://${h}/api/graphql` };
}
const ep = () => endpoints(get().settings.githubHost);

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<{ data: T | null; errors?: { type?: string; message: string }[] }> {
  const r = await pluginHttp(ID, { method: 'POST', url: ep().graphql, auth: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (r.status === 401) throw new AuthError('GitHub rejected the token');
  if (r.status === 403 || r.status === 429) {
    const wait = r.headers['retry-after'];
    throw new Error(/rate limit|abuse|secondary/i.test(r.body) || wait ? `GitHub rate limit${wait ? ` — retry in ${wait}s` : ''}` : 'GitHub: access denied (does the token have access to this org / SSO authorised?)');
  }
  let json: { data?: T | null; errors?: { type?: string; message: string }[] } | null = null;
  try {
    json = JSON.parse(r.body);
  } catch {
    /* not json */
  }
  if (r.status < 200 || r.status >= 300 || !json) throw new Error(`GitHub answered ${r.status}`);
  if (!json.data && json.errors?.length) throw new Error(json.errors[0].message);
  return { data: json.data ?? null, errors: json.errors };
}

/** connect: keep the token in the keychain (bound to the API host) and check it by asking who it is */
export async function connect(token: string): Promise<string> {
  const { host } = ep();
  await pluginSecretSet(ID, host, token);
  try {
    return await whoAmI();
  } catch (e) {
    await pluginSecretSet(ID, host, '').catch(() => {});
    throw e;
  }
}
export const disconnect = () => pluginSecretSet(ID, ep().host, '');
export async function whoAmI(): Promise<string> {
  const { data } = await gql<{ viewer: { login: string } }>('query { viewer { login } }');
  if (!data) throw new Error('GitHub did not say who this token is');
  return data.viewer.login;
}
/** is there a token for the configured host? (and who is it, when the status is already known) */
export async function status() {
  const st = await pluginSecretStatus(ID);
  return { configured: st.configured && st.host === ep().host, host: st.host };
}

const parseRef = (ref: string) => {
  const m = /^github:([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(ref);
  return m ? { owner: m[1], repo: m[2], num: +m[3] } : null;
};

/** one request per 20 PRs, each aliased; a PR that is missing or not visible comes back as `gone` */
export async function fetchPrs(refs: string[]): Promise<Snapshot[]> {
  const out: Snapshot[] = [];
  const parsed = refs.map((r) => ({ ref: r, p: parseRef(r) })).filter((x) => x.p);
  for (let i = 0; i < parsed.length; i += 20) {
    const chunk = parsed.slice(i, i + 20);
    const body = chunk.map((x, j) => `p${j}: repository(owner: "${x.p!.owner}", name: "${x.p!.repo}") { pullRequest(number: ${x.p!.num}) { ...F } }`).join('\n');
    const { data } = await gql<Record<string, { pullRequest: GqlPr | null } | null>>(`query {\n${body}\n}\n${PR_FIELDS}`);
    chunk.forEach((x, j) => {
      const pr = data?.[`p${j}`]?.pullRequest;
      out.push(
        pr
          ? { ...toSnapshot(pr), ref: x.ref }
          : { ref: x.ref, name: `${x.p!.repo}#${x.p!.num}`, title: x.ref.slice(7), view: { glyph: 'closed', label: 'not found', tone: 'info' }, alerts: [], rev: 'gone', gone: true },
      );
    });
  }
  return out;
}

export const LISTS: ListDef[] = [
  { id: 'assigned', label: 'Assigned to me' },
  { id: 'mine', label: 'My PRs' },
  { id: 'mentions', label: 'Mentions' },
];
const queries: Record<string, (me: string) => string> = {
  assigned: (me) => `is:pr is:open review-requested:${me} archived:false sort:updated-desc`,
  mine: (me) => `is:pr author:${me} archived:false sort:updated-desc`,
  mentions: (me) => `is:pr is:open mentions:${me} archived:false sort:updated-desc`,
};
const notes: Record<string, (p: GqlPr) => string> = {
  assigned: (p) => `requested · by ${p.author?.login ?? '?'} · ${ago(p.updatedAt)}`,
  mine: (p) => (p.merged ? `merged · ${ago(p.updatedAt)}` : `updated ${ago(p.updatedAt)}`),
  mentions: (p) => `by ${p.author?.login ?? '?'} · ${ago(p.updatedAt)}`,
};

export async function listPrs(id: string): Promise<Entry[]> {
  const q = queries[id];
  if (!q) return [];
  const me = get().accounts[ID]?.as || (await whoAmI());
  const { data } = await gql<{ search: { nodes: (GqlPr | null)[] } }>(`query($q: String!) { search(query: $q, type: ISSUE, first: 30) { nodes { ... on PullRequest { ...F } } } }\n${PR_FIELDS}`, { q: q(me) });
  return (data?.search.nodes ?? [])
    .filter((p): p is GqlPr => !!p && !!p.number)
    .map((p) => {
      const snap = toSnapshot(p);
      return { ref: refKey(ID, prId(p)), title: p.title, sub: `${p.repository.nameWithOwner} · ${notes[id](p)}`, lead: { glyph: snap.view.glyph, count: snap.view.count }, text: `${p.url} ${p.title}`, snap, canInbox: true } satisfies Entry;
    });
}
export { shortName };
