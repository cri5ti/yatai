/**
 * Settings → each account: how to get the token / link it asks for, with commands to copy and pages to open.
 * Nothing about any particular company is written here: what the user already set (the GitHub host, the DevOps
 * organization) fills the placeholders, otherwise they stay as <placeholders>.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Settings } from './store';
import { openUrl } from './platform';
import { normHost } from './model';
import { orgOf } from './plugins/devops/api';

/** a page to open in the system browser (a plain click: the settings window never navigates) */
function Link({ href, children }: { href: string; children: ReactNode }) {
  const real = !/[<>]/.test(href);
  return real ? (
    <button type="button" className="set-link" title={href} onClick={() => void openUrl(href).catch(() => {})}>
      {children} ↗
    </button>
  ) : (
    <code title="Fill in the placeholder first">{href}</code>
  );
}

/** a command to run, with a copy button */
function Cmd({ children }: { children: string }) {
  const [done, setDone] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(children).then(
      () => (setDone(true), setTimeout(() => setDone(false), 1500)),
      () => {},
    );
  return (
    <div className="set-cmd">
      <pre>{children}</pre>
      <button type="button" className="btn sm" onClick={copy}>
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function github(cfg: Settings) {
  const host = normHost(cfg.githubHost);
  const ghe = host !== 'github.com';
  const flag = ghe ? ` --hostname ${host}` : '';
  return (
    <>
      <h5>Quickest: from the GitHub CLI</h5>
      <p>
        If you use <code>gh</code>, it already has a token. Print it and paste it here (it is broad: whatever <code>gh</code> may do, typically the <code>repo</code> and{' '}
        <code>read:org</code> scopes).
      </p>
      <Cmd>{`gh auth status${flag}\ngh auth token${flag}`}</Cmd>
      <p>
        Not logged in yet: <code>{`gh auth login${flag}`}</code> first.
      </p>
      <h5>Narrower: a fine-grained token</h5>
      <ol>
        <li>
          Open <Link href={`https://${host}/settings/personal-access-tokens/new`}>New fine-grained token</Link>.
        </li>
        <li>Resource owner: the organization that owns the repositories (it may have to approve the token).</li>
        <li>Repository access: the repositories whose pull requests you follow.</li>
        <li>
          Permissions, all <b>Read-only</b>: Pull requests, Commit statuses, Checks (where offered), Metadata.
        </li>
      </ol>
      <p>
        Or a classic token with the <code>repo</code> scope: <Link href={`https://${host}/settings/tokens/new?scopes=repo&description=yatai`}>New classic token</Link>.
      </p>
      <p className="set-fine">
        If the organization uses SAML single sign-on, authorize the token for it (Tokens → Configure SSO → Authorize), or GitHub answers as if its pull requests did not exist.
      </p>
    </>
  );
}

function devops(cfg: Settings) {
  const o = orgOf(cfg.devopsOrg);
  const base = o?.base ?? 'https://dev.azure.com/<your-org>';
  // the PAT API lives on vssps.dev.azure.com/<org> (for <org>.visualstudio.com too)
  const name = o ? (o.host === 'dev.azure.com' ? o.base.split('/').pop()! : o.host.split('.')[0]) : '<your-org>';
  const body = `{ "displayName": "yatai", "scope": "vso.build", "validTo": "${inDays(90)}T00:00:00Z", "allOrgs": false }`;
  return (
    <>
      <h5>In the browser</h5>
      <ol>
        <li>
          Open <Link href={`${base}/_usersSettings/tokens`}>Personal access tokens</Link> → <b>New Token</b>.
        </li>
        <li>
          Organization: yours; expiration: up to your policy; Scopes: <b>Custom defined</b> → <b>Build: Read</b>.
        </li>
        <li>Create, copy the token, paste it here.</li>
      </ol>
      <h5>From the Azure CLI</h5>
      <p>
        Sign in, save the request below as <code>pat.json</code>, then ask Azure DevOps for a token with Build (Read) only, valid for 90 days. Works the same in PowerShell and bash.
      </p>
      <Cmd>{body}</Cmd>
      <Cmd>{`az login\naz rest --method post --resource 499b84ac-1321-427f-aa17-267ca6975798 --uri "https://vssps.dev.azure.com/${name}/_apis/tokens/pats?api-version=7.1-preview.1" --body @pat.json --query patToken.token -o tsv`}</Cmd>
      <p className="set-fine">
        <code>499b84ac-…</code> is Azure DevOps' fixed application id, not a secret. If your organization only allows tokens through a policy, the browser route is the one that works.
      </p>
    </>
  );
}

function outlook() {
  return (
    <>
      <h5>Publish your calendar (Outlook on the web)</h5>
      <ol>
        <li>
          Open <Link href="https://outlook.office.com/calendar/options/calendar/SharedCalendars">Calendar → Shared calendars</Link> (an outlook.com account:{' '}
          <Link href="https://outlook.live.com/calendar/0/options/calendar/SharedCalendars">this one</Link>).
        </li>
        <li>
          Under <b>Publish a calendar</b>: choose the calendar and <b>Can view all details</b> (or titles and locations), then <b>Publish</b>.
        </li>
        <li>
          Copy the <b>ICS</b> link (not the HTML one), paste it here.
        </li>
      </ol>
      <p className="set-fine">
        Anyone with the link can read the calendar: yatai keeps it in the keychain. To revoke it, choose Unpublish (or Reset links) on the same page. If there is no Publish
        section, your organization has turned publishing off; there is no command-line route, because reading the calendar through Microsoft Graph needs an administrator's consent.
      </p>
    </>
  );
}

const GUIDES: Record<string, (cfg: Settings) => ReactNode> = { github, devops, outlook };

/** "How to get it", open until the account is connected */
export function Guide({ id, cfg, connected }: { id: string; cfg: Settings; connected: boolean }) {
  const g = GUIDES[id];
  if (!g) return null;
  return (
    <details className="set-guide" open={!connected}>
      <summary>How to get it</summary>
      {g(cfg)}
    </details>
  );
}
