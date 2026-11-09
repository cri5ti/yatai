/** Azure DevOps (live): pipeline runs (builds) by their links. The personal access token goes through Rust as Basic auth. */
import { get } from '../../store';
import { pluginHttp, pluginSecretSet, pluginSecretStatus } from '../../platform';
import { AuthError } from '../types';
import type { Entry, ListDef, Snapshot } from '../types';
import { byRunning, entryOf, toSnapshot } from './map';
import type { AdoBuild } from './map';

export const ID = 'devops';
const V = 'api-version=7.1';

/** 'acme', 'dev.azure.com/acme', 'https://dev.azure.com/acme/', 'acme.visualstudio.com' → where the organization lives */
export function orgOf(setting: string): { host: string; base: string } | null {
  let t = setting.trim().replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!t) return null;
  if (!t.includes('.') && !t.includes('/')) t = `dev.azure.com/${t}`;
  const parts = t.split('/');
  const host = parts[0].toLowerCase();
  // dev.azure.com/<org>; <org>.visualstudio.com is the organization by itself
  const base = host === 'dev.azure.com' ? (parts[1] ? `${host}/${parts[1]}` : null) : host;
  return base ? { host, base: `https://${base}` } : null;
}
const org = () => {
  const o = orgOf(get().settings.devopsOrg);
  if (!o) throw new Error('set your organization in Settings (e.g. dev.azure.com/acme)');
  return o;
};

async function call<T>(url: string): Promise<T> {
  const r = await pluginHttp(ID, { url, auth: true, scheme: 'basic', headers: { Accept: 'application/json' } });
  // a rejected token is a 401, or a 203 / 302 to the sign-in page
  if (r.status === 401 || r.status === 203 || (r.status >= 300 && r.status < 400)) throw new AuthError('Azure DevOps rejected the token');
  if (r.status === 404) throw Object.assign(new Error('not found'), { gone: true });
  if (r.status === 403) throw Object.assign(new Error('the token may not read this (needs Build: Read)'), { gone: true });
  if (r.status === 429) throw new Error('Azure DevOps rate limit');
  if (r.status < 200 || r.status >= 300) throw new Error(`Azure DevOps answered ${r.status}`);
  try {
    return JSON.parse(r.body) as T;
  } catch {
    throw new AuthError('Azure DevOps did not answer with data (is the token right?)');
  }
}

export async function whoAmI(): Promise<string> {
  const d = await call<{ authenticatedUser?: { providerDisplayName?: string } }>(`${org().base}/_apis/connectionData`);
  return d.authenticatedUser?.providerDisplayName ?? 'you';
}
export async function connect(token: string): Promise<string> {
  const { host } = org();
  await pluginSecretSet(ID, host, token);
  try {
    return await whoAmI();
  } catch (e) {
    await pluginSecretSet(ID, host, '').catch(() => {});
    throw e;
  }
}
export const disconnect = async () => void (await pluginSecretSet(ID, orgOf(get().settings.devopsOrg)?.host ?? 'dev.azure.com', ''));
export async function configured() {
  const st = await pluginSecretStatus(ID);
  return st.configured && st.host === orgOf(get().settings.devopsOrg)?.host;
}

/** devops:build/<host>/<org…>/<project>#<id> → the run, one request each (Next holds a handful) */
export async function fetchBuilds(refs: string[]): Promise<Snapshot[]> {
  const out: Snapshot[] = [];
  for (const ref of refs) {
    const m = /^devops:build\/(.+)#(\d+)$/.exec(ref);
    if (!m) continue;
    try {
      out.push(toSnapshot(ref, await call<AdoBuild>(`https://${m[1]}/_apis/build/builds/${m[2]}?${V}`)));
    } catch (e) {
      if (e instanceof AuthError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      // another organization's link (the token is bound to one host), or one this token cannot see
      if ((e as { gone?: boolean }).gone || /only for/.test(msg)) {
        const name = `${decodeURIComponent(m[1].split('/').pop() ?? '')} #${m[2]}`;
        out.push({
          ref,
          name,
          title: name,
          view: { glyph: 'unknown', label: 'no access', tone: 'warn' },
          alerts: [{ key: 'gone', tone: 'warn', text: `Can't see ${name}`, toast: `${name}: Azure DevOps ${msg}` }],
          rev: 'gone',
          gone: true,
        });
      } else throw e;
    }
  }
  return out;
}

/* ---------- the Pipelines list: every run that is going or waiting, across the organization's projects ---------- */
export const LISTS: ListDef[] = [{ id: 'pipelines', label: 'Pipelines' }];

// the project list changes rarely: asked once an hour
let projects: { org: string; at: number; names: string[] } | null = null;
async function projectNames(base: string): Promise<string[]> {
  if (projects && projects.org === base && Date.now() - projects.at < 3_600_000) return projects.names;
  const d = await call<{ value: { name: string }[] }>(`${base}/_apis/projects?$top=500&stateFilter=wellFormed&${V}`);
  projects = { org: base, at: Date.now(), names: d.value.map((p) => p.name).sort() };
  return projects.names;
}

/** one request per project (six at a time); a project the token cannot read is left out */
export async function listPipelines(): Promise<Entry[]> {
  const { base } = org();
  const names = await projectNames(base);
  const found: { at: string; b: import('./map').AdoBuild }[] = [];
  let failed: unknown = null;
  for (let i = 0; i < names.length; i += 6) {
    await Promise.all(
      names.slice(i, i + 6).map(async (name) => {
        const at = `${base.replace(/^https:\/\//, '')}/${encodeURIComponent(name)}`;
        try {
          const d = await call<{ value: import('./map').AdoBuild[] }>(`https://${at}/_apis/build/builds?statusFilter=inProgress,notStarted,postponed,cancelling&queryOrder=queueTimeDescending&$top=50&${V}`);
          for (const b of d.value) found.push({ at, b });
        } catch (e) {
          if (e instanceof AuthError) throw e;
          if (!(e as { gone?: boolean }).gone) failed = e;
        }
      }),
    );
  }
  if (!found.length && failed) throw failed;
  return found.sort((x, y) => byRunning(x.b, y.b)).map((x) => entryOf(x.at, x.b));
}
