/**
 * Settings → Microsoft: the Entra app registration and the one sign-in behind every source that is set (Settings → Sources)
 * to "Microsoft app registration". This page only exists while some source is.
 */
import { useEffect, useRef, useState } from 'react';
import { act } from './act';
import type { Settings } from './store';
import { isTauri } from './platform';
import { SOURCES, entraStatus, wanted } from './plugins/entra';
import type { EntraStatus } from './plugins/entra';
import { Guide } from './guides';

export function MicrosoftSettings({ cfg, patch, enter }: { cfg: Settings; patch: (p: Partial<Settings>) => void; enter: (e: React.KeyboardEvent) => void }) {
  const [st, setSt] = useState<EntraStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (isTauri) void entraStatus().then(setSt);
    return () => void (alive.current = false);
  }, []);

  const used = SOURCES.filter((x) => wanted(cfg).includes(x.id));
  const covered = (x: (typeof SOURCES)[number]) => !!st?.configured && st.client === cfg.entraClient.trim() && !!st.scopes[x.res]?.includes(x.scope);
  const pending = used.filter((x) => !covered(x));
  const signedIn = !!st?.configured;

  const signIn = async () => {
    setBusy(true);
    // runs in the main window (this one may be a popup): the browser opens there; from here we only watch the keychain's answer
    await act.microsoftSignIn(cfg.entraClient, cfg.entraTenant, used.map((x) => x.id));
    for (let i = 0; i < 100 && alive.current; i++) {
      const now = await entraStatus();
      setSt(now);
      if (used.every((x) => !!now.scopes[x.res]?.includes(x.scope) && now.client === cfg.entraClient.trim())) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (alive.current) setBusy(false);
  };

  return (
    <section className="set-sec">
      <header>
        <h4>Microsoft</h4>
        <span className="set-hint">{!isTauri ? 'needs the desktop app' : busy ? 'waiting for the browser…' : signedIn ? `✓ signed in as ${st?.account ?? 'you'}` : 'not signed in'}</span>
      </header>
      <p className="set-note">
        One sign-in for the sources set to “Microsoft app registration”: {used.map((x) => x.label).join(', ') || 'none yet'}. It happens in your browser, is kept in the OS keychain and renews itself.
      </p>
      <div className="set-row">
        <span className="set-lbl">
          Application (client) ID<small>From the app registration below.</small>
        </span>
        <input value={cfg.entraClient} spellCheck={false} disabled={!isTauri || busy} onChange={(e) => patch({ entraClient: e.target.value })} onKeyDown={enter} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
      <div className="set-row">
        <span className="set-lbl">
          Tenant<small>The directory (tenant) ID or domain. Blank: any work account.</small>
        </span>
        <input value={cfg.entraTenant} spellCheck={false} disabled={!isTauri || busy} onChange={(e) => patch({ entraTenant: e.target.value })} onKeyDown={enter} placeholder="contoso.onmicrosoft.com" />
      </div>
      <div className="set-row">
        <span className="set-lbl">
          Permissions
          <small>{used.length ? used.map((x) => `${x.label}: ${covered(x) ? '✓ granted' : 'not granted yet'}`).join(' · ') : 'Nothing needs them.'}</small>
        </span>
        <span className="set-key">
          <button className="btn sm primary" disabled={!isTauri || busy || !cfg.entraClient.trim() || !pending.length} title={cfg.entraClient.trim() ? '' : 'Fill in the application ID first'} onClick={() => void signIn()}>
            {signedIn ? 'Sign in for the new permissions' : 'Sign in'}
          </button>
          {signedIn && (
            <button
              className="btn sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await act.microsoftSignOut();
                setSt(await entraStatus());
                setBusy(false);
              }}
            >
              Sign out
            </button>
          )}
        </span>
      </div>
      <Guide id="microsoft" cfg={cfg} connected={signedIn} />
    </section>
  );
}
