/**
 * The one Microsoft (Entra ID) account behind Calendar, Emails and Azure DevOps (design/plugins.md §9).
 * Rust (src-tauri/src/entra.rs) does the sign-in in the system browser, keeps the refresh token in the keychain and adds
 * an access token to a request; the page only says which resource a request is for and never sees a token.
 */
import { get, set } from '../store';
import { invoke, isTauri, openUrl, requests } from '../platform';
import type { HttpRes } from '../platform';
import { AuthError } from './types';

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

/** is the source switched on in Settings and covered by what the account has been consented for? (sync: reads the last status) */
export function entraOn(src: Source): boolean {
  const s = sourceOf(src);
  return get().settings.entraSources.includes(src) && !!cached.scopes[s.res]?.includes(s.scope);
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
 * Switch a source on or off. Switching on signs in when the account was not yet consented for what it needs (one browser
 * round trip, nothing else); off only stops using it (the consent stays in Entra until the user removes it there).
 */
export async function setSource(src: Source, on: boolean, client: string, tenant: string): Promise<void> {
  const { settings } = get();
  const next = on ? [...new Set([...settings.entraSources, src])] : settings.entraSources.filter((x) => x !== src);
  if (on) {
    await entraStatus();
    const need = scopesFor(sourceOf(src).res, next as Source[]);
    const have = cached.scopes[sourceOf(src).res] ?? [];
    const sameAccount = cached.configured && cached.client === client.trim();
    if (!sameAccount || need.some((n) => !have.includes(n))) await signIn(client, tenant, sourceOf(src).res, need);
  }
  set((s) => ({ settings: { ...s.settings, entraClient: client.trim(), entraTenant: tenant.trim(), entraSources: next } }));
}

export async function signOut(): Promise<void> {
  cached = await invoke<EntraStatus>('entra_sign_out');
  set((s) => ({ settings: { ...s.settings, entraSources: [] } }));
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
