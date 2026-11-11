/**
 * The one Microsoft (Entra ID) account behind Calendar, Emails and Azure DevOps (design/plugins.md §9).
 * Rust (src-tauri/src/entra.rs) does the sign-in in the system browser, keeps the refresh token in the keychain and adds
 * an access token to a request; the page only says which resource a request is for and never sees a token.
 */
import { get, set } from '../store';
import { invoke, isTauri, openUrl, requests } from '../platform';
import type { HttpRes } from '../platform';
import { AuthError } from './types';
import { enabled, methodOf } from './config';
import type { Settings } from '../store';

export type Source = 'calendar' | 'mail' | 'devops';
export type Resource = 'graph' | 'devops';

/** what each source needs from Microsoft; ticking one in Settings asks for exactly this */
export const SOURCES: { id: Source; plugin: string; label: string; help: string; res: Resource; scope: string }[] = [
  { id: 'calendar', plugin: 'outlook', label: 'Calendar', help: 'Your meetings, live (Calendars.Read).', res: 'graph', scope: 'Calendars.Read' },
  { id: 'mail', plugin: 'mail', label: 'Emails', help: 'Your unread mail, read-only (Mail.Read): no classic Outlook needed.', res: 'graph', scope: 'Mail.Read' },
  { id: 'devops', plugin: 'devops', label: 'Azure DevOps', help: 'Pipeline runs and work items (user_impersonation).', res: 'devops', scope: 'user_impersonation' },
];
const sourceOf = (id: Source) => SOURCES.find((s) => s.id === id)!;

export interface EntraStatus {
  configured: boolean;
  account: string | null;
  client: string | null;
  tenant: string | null;
  scopes: Record<string, string[]>; // resource -> the scopes it was consented for
}
const NONE: EntraStatus = { configured: false, account: null, client: null, tenant: null, scopes: {} };
let cached: EntraStatus = NONE;
export const entraCached = () => cached;

export async function entraStatus(): Promise<EntraStatus> {
  cached = isTauri ? await invoke<EntraStatus>('entra_status') : NONE;
  return cached;
}

/** the sources that are on and set to sign in with the Microsoft app registration (Settings → Sources) */
export const wanted = (settings: Pick<Settings, 'sources'>): Source[] => SOURCES.filter((s) => enabled(settings, s.plugin) && methodOf(settings, s.plugin) === 'app').map((s) => s.id);

/** does the source use the Microsoft account, and is it covered by what the account has been consented for? (sync: reads the last status) */
export function entraOn(src: Source): boolean {
  const s = sourceOf(src);
  return wanted(get().settings).includes(src) && !!cached.scopes[s.res]?.includes(s.scope);
}

/** what has to be asked from a resource for these sources (Graph also needs User.Read to say who is signed in) */
export function scopesFor(res: Resource, sources: Source[]): string[] {
  const names = SOURCES.filter((s) => s.res === res && sources.includes(s.id)).map((s) => s.scope);
  return res === 'graph' && names.length ? ['User.Read', ...names] : names;
}

/** the browser opens, the user signs in (and consents), Rust keeps the refresh token */
async function signIn(client: string, tenant: string, res: Resource, names: string[]): Promise<EntraStatus> {
  const url = await invoke<string>('entra_begin', { client, tenant, res, names });
  const done = invoke<EntraStatus>('entra_finish');
  await openUrl(url);
  cached = await done;
  return cached;
}

/**
 * Sign in (the browser opens) for everything the sources set to "Microsoft app registration" need, asking only for what
 * the account has not been consented for yet. `sources` is what Settings has now, saved or not.
 */
export async function grant(client: string, tenant: string, sources: Source[]): Promise<void> {
  client = client.trim();
  if (!client) throw new Error('fill in the application (client) ID first');
  if (!sources.length) throw new Error('no source is set to use the Microsoft app registration');
  await entraStatus();
  for (const res of ['graph', 'devops'] as Resource[]) {
    const need = scopesFor(res, sources);
    if (!need.length) continue;
    const have = cached.configured && cached.client === client ? cached.scopes[res] ?? [] : [];
    if (need.some((n) => !have.includes(n))) await signIn(client, tenant, res, need);
  }
  set((s) => ({ settings: { ...s.settings, entraClient: client, entraTenant: tenant.trim() } }));
}

export async function signOut(): Promise<void> {
  cached = await invoke<EntraStatus>('entra_sign_out');
}

/** a request to Graph / Azure DevOps as the signed-in user; a 401 (signed out, or Microsoft wants a new sign-in) is an AuthError */
export async function entraHttp(plugin: string, res: Resource, req: { method?: string; url: string; headers?: Record<string, string>; body?: string }): Promise<HttpRes> {
  requests.count(plugin);
  const r = await invoke<HttpRes>('plugin_http', { req: { plugin, method: req.method, url: req.url, headers: req.headers, body: req.body, auth: true, entra: res } });
  if (r.status === 401) throw new AuthError(r.body && !r.body.startsWith('{') ? `Microsoft: ${r.body}` : 'Microsoft rejected the sign-in: sign in again in Settings');
  return r;
}

/** Graph GET, parsed; follows `@odata.nextLink` for up to `pages` pages and returns all the `value`s */
export async function graph<T>(plugin: string, path: string, opts: { pages?: number; headers?: Record<string, string> } = {}): Promise<T[]> {
  let url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const out: T[] = [];
  for (let i = 0; i < (opts.pages ?? 1) && url; i++) {
    const r = await entraHttp(plugin, 'graph', { url, headers: { Accept: 'application/json', ...opts.headers } });
    if (r.status === 403) throw new AuthError('Microsoft Graph refused: the app registration lacks the permission (or the tenant did not allow it)');
    if (r.status === 429) throw new Error('Microsoft Graph rate limit');
    if (r.status < 200 || r.status >= 300) throw new Error(`Microsoft Graph answered ${r.status}`);
    const d = JSON.parse(r.body) as { value?: T[]; '@odata.nextLink'?: string };
    out.push(...(d.value ?? []));
    url = d['@odata.nextLink'] ?? '';
  }
  return out;
}

/** who is signed in: the user name (and the display name, when Graph says it) */
export async function whoAmI(plugin: string): Promise<string> {
  const r = await entraHttp(plugin, 'graph', { url: 'https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName', headers: { Accept: 'application/json' } });
  if (r.status < 200 || r.status >= 300) throw new Error(`Microsoft Graph answered ${r.status}`);
  const d = JSON.parse(r.body) as { displayName?: string; userPrincipalName?: string };
  return d.userPrincipalName ?? d.displayName ?? 'you';
}
