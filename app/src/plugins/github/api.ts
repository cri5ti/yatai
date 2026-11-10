import { get } from '../../store';
import { normHost } from '../../model';
import { pluginHttp, pluginSecretSet, pluginSecretStatus } from '../../platform';
import { AuthError } from '../types';
import type { Entry, ListDef, Snapshot } from '../types';
import { PR_FIELDS, PR_LIGHT, ago, basisOf, prId, shortName, toSnapshot } from './map';
import { setQuota } from '../requests';
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
  const rl = (json.data as { rateLimit?: { remaining: number; limit: number; resetAt: string } } | null | undefined)?.rateLimit;
  if (rl) setQuota(ID, { left: rl.remaining, limit: rl.limit, reset: Date.parse(rl.resetAt) });
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

/** one query per 20 PRs, each aliased: ref -> the PR (or null, with GitHub's reason) */
async function queryPrs(refs: string[], fragment: string): Promise<Map<string, { pr: GqlPr | null; why?: string }>> {
  const out = new Map<string, { pr: GqlPr | null; why?: string }>();
  const parsed = refs.map((r) => ({ ref: r, p: parseRef(r) })).filter((x) => x.p);
  for (let i = 0; i < parsed.length; i += 20) {
    const chunk = parsed.slice(i, i + 20);
    const body = chunk.map((x, j) => `p${j}: repository(owner: "${x.p!.owner}", name: "${x.p!.repo}") { pullRequest(number: ${x.p!.num}) { ...F } }`).join('\n');
    const { data, errors } = await gql<Record<string, { pullRequest: GqlPr | null } | null>>(`query {\n${body}\nrateLimit { remaining limit resetAt }\n}\n${fragment}`);
    chunk.forEach((x, j) => {
      // GitHub says "not found" for a repo the token may not see (org not approved, repo not selected, SSO), so say that
      const why = errors?.find((e) => (e as { path?: unknown[] }).path?.[0] === `p${j}`)?.message;
      out.set(x.ref, { pr: data?.[`p${j}`]?.pullRequest ?? null, why });
    });
  }
  return out;
}

/**
 * Two steps. Every PR gets the light query; only the ones that are new, changed since their details were fetched
 * (the basis differs) or that the user refreshed (`force`) get the full one. The others keep their last snapshot.
 * A PR that is missing or not visible comes back as `gone`.
 */
export async function fetchPrs(refs: string[], opts: { force?: boolean } = {}): Promise<Snapshot[]> {
  const prev = get().snaps;
  const light = opts.force ? new Map<string, { pr: GqlPr | null; why?: string }>() : await queryPrs(refs, PR_LIGHT);
  const need = opts.force ? refs : refs.filter((r) => {
    const pr = light.get(r)?.pr;
    return pr && (!prev[r]?.basis || prev[r].basis !== basisOf(pr));
  });
  const full = need.length ? await queryPrs(need, PR_FIELDS) : new Map<string, { pr: GqlPr | null; why?: string }>();
  const out: Snapshot[] = [];
  for (const ref of refs) {
    const x = { ref, p: parseRef(ref) };
    if (!x.p) continue;
    const got = full.get(ref) ?? light.get(ref);
    const pr = got?.pr;
    const why = got?.why;
    const name = `${x.p.repo}#${x.p.num}`;
    {
      out.push(
        pr && full.has(ref)
          ? { ...toSnapshot(pr), ref }
          : pr && prev[ref]
            ? prev[ref] // unchanged since its details were fetched
            : pr
              ? { ...toSnapshot(pr, false), ref }
              : {
              ref,
              name,
              title: ref.slice(7),
              view: { glyph: 'review', label: 'no access', tone: 'warn' },
              alerts: [{ key: 'gone', tone: 'warn', text: `Can't see ${name} with this token`, toast: `${name}: GitHub can't find it with this token${why ? ` (${why})` : ''}. Check the token's repositories, the org's approval and SSO.` }],
              rev: 'gone',
              gone: true,
            },
      );
    }
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
  // the light fields: a list does not need the details (they are fetched once the PR is in Next)
  const { data } = await gql<{ search: { nodes: (GqlPr | null)[] } }>(`query($q: String!) { search(query: $q, type: ISSUE, first: 30) { nodes { ... on PullRequest { ...F } } }\nrateLimit { remaining limit resetAt } }\n${PR_LIGHT}`, { q: q(me) });
  return (data?.search.nodes ?? [])
    .filter((p): p is GqlPr => !!p && !!p.number)
    .map((p) => {
      const snap = toSnapshot(p, false);
      return { ref: refKey(ID, prId(p)), title: p.title, sub: `${p.repository.nameWithOwner} · ${notes[id](p)}`, lead: { glyph: snap.view.glyph, count: snap.view.count, turn: snap.view.turn }, text: `${p.url} ${p.title}${snap.desc ? `\n${snap.desc}` : ''}`, snap, canInbox: true } satisfies Entry;
    });
}
export { shortName };
