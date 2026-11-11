/** Azure DevOps with the Azure CLI's sign-in (src-tauri/src/azcli.rs): the token is asked from `az` by Rust and never reaches the page. */
import { invoke, requests } from '../platform';
import type { HttpRes } from '../platform';
import { AuthError } from './types';

export async function azHttp(plugin: string, req: { method?: string; url: string; headers?: Record<string, string>; body?: string }): Promise<HttpRes> {
  requests.count(plugin);
  const r = await invoke<HttpRes>('plugin_http', { req: { plugin, method: req.method, url: req.url, headers: req.headers, body: req.body, auth: true, az: 'devops' } });
  if (r.status === 401 && r.body && !r.body.startsWith('{') && !r.body.startsWith('<')) throw new AuthError(r.body); // "Run `az login` again (…)"
  return r;
}

/** is `az` installed and signed in? resolves with a word, rejects with what to do */
export const azCheck = () => invoke<string>('az_check');
