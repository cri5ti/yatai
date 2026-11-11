/**
 * Which sources are switched on, and how each one signs in (Settings → Sources). A source with no entry is on, with its
 * first method. The pages in Settings, the buttons in the footer and the polling all follow this.
 */
import type { Settings } from '../store';

export interface Method {
  id: string;
  label: string;
  help: string;
}

/** how each source can authenticate; the first is the default. Sources not listed need nothing (they read this PC). */
export const METHODS: Record<string, Method[]> = {
  github: [{ id: 'token', label: 'Access token', help: 'A personal access token (or the one from gh), kept in the keychain.' }],
  outlook: [
    { id: 'ics', label: 'Published calendar link (ICS)', help: 'No sign-in and no admin; the feed lags behind Outlook by minutes.' },
    { id: 'app', label: 'Microsoft app registration', help: 'Microsoft Graph, live. Needs the yatai app registered in Entra (and maybe an admin’s approval).' },
  ],
  mail: [
    { id: 'com', label: 'Classic Outlook on this PC', help: 'Through COM: Windows with classic Outlook only (not the new Outlook).' },
    { id: 'app', label: 'Microsoft app registration', help: 'Microsoft Graph: no Outlook needed. Needs the yatai app registered in Entra (and maybe an admin’s approval).' },
  ],
  devops: [
    { id: 'token', label: 'Personal access token', help: 'A PAT with Build and Work Items read, kept in the keychain.' },
    { id: 'az', label: 'Azure CLI (az login)', help: 'Uses the sign-in of the Azure CLI as you: no token to paste, no app registration.' },
    { id: 'app', label: 'Microsoft app registration', help: 'The Microsoft account of Settings → Microsoft.' },
  ],
};

export const enabled = (s: Pick<Settings, 'sources'>, id: string) => s.sources?.[id]?.on !== false;

export function methodOf(s: Pick<Settings, 'sources'>, id: string): string {
  const ms = METHODS[id];
  return ms?.find((m) => m.id === s.sources?.[id]?.auth)?.id ?? ms?.[0]?.id ?? '';
}
