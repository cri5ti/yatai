/**
 * The Emails source through Microsoft Graph (the Microsoft account in Settings → Microsoft), as an alternative to the
 * classic Outlook's COM. It answers exactly as src-tauri/src/mail.ps1 does (same input, same JSON out), so the rest of
 * the plugin does not care which one is behind it. Read-only: `Mail.Read` cannot change anything.
 */
import { AuthError } from '../types';
import { entraHttp, entraOn, entraStatus, graph, whoAmI } from '../entra';
import type { Fetched } from './model';

const ID = 'mail';

interface Folder {
  id: string;
  displayName: string;
  unreadItemCount?: number;
  childFolderCount?: number;
}
interface Node {
  path: string;
  depth: number;
  id: string;
  unread: number;
}
/** the folders left out, as with COM: deleted, drafts, junk, sent, outbox and the like (found by their well-known names, so not by language) */
const SYSTEM = ['deleteditems', 'drafts', 'junkemail', 'sentitems', 'outbox', 'conversationhistory', 'syncissues', 'conflicts', 'localfailures', 'serverfailures', 'clutter', 'scheduled', 'searchfolders'];

let tree: { at: number; nodes: Node[]; inbox: string } | null = null;

async function systemIds(): Promise<Set<string>> {
  // /me/mailFolders/{name} answers one object, not a list
  const out = new Set<string>();
  await Promise.all(
    SYSTEM.map(async (n) => {
      try {
        const r = await one<{ id: string }>(`/me/mailFolders/${n}?$select=id`);
        if (r?.id) out.add(r.id);
      } catch (e) {
        if (e instanceof AuthError) throw e;
      }
    }),
  );
  return out;
}

async function one<T>(path: string): Promise<T | null> {
  const r = await entraHttp(ID, 'graph', { url: `https://graph.microsoft.com/v1.0${path}`, headers: { Accept: 'application/json' } });
  if (r.status === 404) return null;
  if (r.status < 200 || r.status >= 300) throw new Error(`Microsoft Graph answered ${r.status}`);
  return JSON.parse(r.body) as T;
}

/** every mail folder of the user's own mailbox, with its path ('Inbox', 'Inbox\Team'), cached for a few minutes */
async function folders(): Promise<{ nodes: Node[]; inbox: string }> {
  if (tree && Date.now() - tree.at < 5 * 60_000) return tree;
  const skip = await systemIds();
  const nodes: Node[] = [];
  const sel = '$select=id,displayName,unreadItemCount,childFolderCount&$top=100';
  const walk = async (list: Folder[], prefix: string, depth: number) => {
    for (const f of list) {
      if (skip.has(f.id)) continue;
      const path = prefix ? `${prefix}\\${f.displayName}` : f.displayName;
      nodes.push({ path, depth, id: f.id, unread: f.unreadItemCount ?? 0 });
      if (f.childFolderCount) await walk(await graph<Folder>(ID, `/me/mailFolders/${f.id}/childFolders?${sel}`, { pages: 5 }), path, depth + 1);
    }
  };
  await walk(await graph<Folder>(ID, `/me/mailFolders?${sel}`, { pages: 5 }), '', 0);
  const inboxId = (await one<{ id: string }>('/me/mailFolders/inbox?$select=id'))?.id;
  tree = { at: Date.now(), nodes, inbox: nodes.find((n) => n.id === inboxId)?.path ?? 'Inbox' };
  return tree;
}

interface Msg {
  id: string;
  conversationId?: string;
  receivedDateTime: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  subject?: string;
  isRead?: boolean;
  importance?: 'low' | 'normal' | 'high';
  hasAttachments?: boolean;
  body?: { content?: string };
}
const names = (l?: Msg['toRecipients']) => (l ?? []).map((r) => r.emailAddress?.name || r.emailAddress?.address || '').filter(Boolean).join('; ');
const domain = (a?: string) => (a ?? '').split('@')[1]?.toLowerCase() ?? '';

export interface Input {
  mode?: 'folders';
  days?: number;
  limit?: number;
  known?: string[];
  folders?: string[];
}

/** same answer as mail.ps1 (a JSON string) */
export async function graphMail(input: Input): Promise<string> {
  try {
    await entraStatus();
    if (!entraOn('mail')) return JSON.stringify({ error: 'the Microsoft account is not signed in for Emails (Settings → Microsoft)' });
    const t = await folders();
    if (input.mode === 'folders') return JSON.stringify({ inbox: t.inbox, folders: t.nodes.map(({ path, depth, unread }) => ({ path, depth, unread })) });

    const limit = input.limit ?? 200;
    const cutoff = input.days && input.days > 0 ? new Date(Date.now() - input.days * 864e5).toISOString() : '1900-01-01T00:00:00Z';
    const known = new Set(input.known ?? []);
    const me = await whoAmI(ID).catch(() => '');
    const mine = domain(me);
    const out = new Map<string, Fetched>();
    const missing: string[] = [];
    for (const path of (input.folders ?? []).filter(Boolean)) {
      const f = t.nodes.find((n) => n.path.toLowerCase() === path.toLowerCase());
      if (!f) {
        missing.push(path);
        continue;
      }
      if (f.unread === 0 || out.size >= limit) continue;
      // the order-by property has to come first in the filter, or Graph refuses it as "inefficient"
      const q = `$filter=${encodeURIComponent(`receivedDateTime ge ${cutoff} and isRead eq false`)}&$orderby=receivedDateTime desc&$top=${Math.min(50, limit)}&$select=id,conversationId,receivedDateTime,from,toRecipients,ccRecipients,subject,isRead,importance,hasAttachments,body`;
      const msgs = await graph<Msg>(ID, `/me/mailFolders/${f.id}/messages?${q}`, { pages: Math.ceil(limit / 50), headers: { Prefer: 'outlook.body-content-type="text"' } });
      for (const m of msgs) {
        if (out.size >= limit) break;
        if (out.has(m.id)) continue;
        const a = m.from?.emailAddress;
        const o: Fetched = {
          id: m.id,
          folder: path,
          conv: m.conversationId,
          received: new Date(m.receivedDateTime).toISOString(),
          from: a?.name || a?.address || '',
          // a sender in the user's own organisation is "a colleague" to the sorter (as an Exchange address is with COM)
          fromAddr: domain(a?.address) === mine ? '' : a?.address ?? '',
          to: names(m.toRecipients),
          cc: names(m.ccRecipients),
          subject: m.subject ?? '',
          unread: m.isRead === false,
          importance: m.importance === 'high' ? 2 : m.importance === 'low' ? 0 : 1,
          attach: m.hasAttachments ? 1 : 0,
        };
        if (!known.has(m.id)) o.body = (m.body?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
        out.set(m.id, o);
      }
    }
    return JSON.stringify({ me: me.split('@')[0], missing, items: [...out.values()].sort((a, b) => b.received.localeCompare(a.received)) });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}
