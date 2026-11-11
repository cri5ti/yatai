/** Settings → Microsoft: one account (Entra ID) and tick boxes for what it is used for: Calendar, Emails, Azure DevOps. */
import { useEffect, useState } from 'react';
import { act } from './act';
import { useS } from './store';
import type { Settings } from './store';
import { isTauri } from './platform';
import { SOURCES, entraStatus } from './plugins/entra';
import type { EntraStatus, Source } from './plugins/entra';
import { Guide } from './guides';

export function MicrosoftSettings({ cfg, patch, enter }: { cfg: Settings; patch: (p: Partial<Settings>) => void; enter: (e: React.KeyboardEvent) => void }) {
  const used = useS().settings.entraSources;
  const [st, setSt] = useState<EntraStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (isTauri) void entraStatus().then(setSt);
  }, [used]);

  const signedIn = !!st?.configured;
  const ready = isTauri && !!cfg.entraClient.trim();
  const toggle = async (src: Source, on: boolean) => {
    setBusy(src);
    // the browser opens for the first one (and for a new permission). It runs in the main window (this one may be a popup);
    // what it decides (the sources, the client id) is saved at once, not with Save
    await act.microsoftSource(src, on, cfg.entraClient, cfg.entraTenant);
    setSt(await entraStatus());
    setBusy(null);
  };

  return (
    <section className="set-sec">
      <header>
        <h4>Microsoft</h4>
        <span className="set-hint">{!isTauri ? 'needs the desktop app' : busy ? 'waiting for the browser…' : signedIn ? `✓ signed in as ${st?.account ?? 'you'}` : 'not signed in'}</span>
      </header>
      <p className="set-note">One Microsoft sign-in for the calendar, your mail and Azure DevOps: it happens in your browser, is kept in the OS keychain and renews itself. Tick what yatai may use it for.</p>
      <div className="set-row">
        <span className="set-lbl">
          Application (client) ID<small>From the app registration below.</small>
        </span>
        <input value={cfg.entraClient} spellCheck={false} disabled={!isTauri || !!busy} onChange={(e) => patch({ entraClient: e.target.value })} onKeyDown={enter} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
      <div className="set-row">
        <span className="set-lbl">
          Tenant<small>The directory (tenant) ID or domain. Blank: any work account.</small>
        </span>
        <input value={cfg.entraTenant} spellCheck={false} disabled={!isTauri || !!busy} onChange={(e) => patch({ entraTenant: e.target.value })} onKeyDown={enter} placeholder="contoso.onmicrosoft.com" />
      </div>
      {SOURCES.map((x) => (
        <label className="set-row set-tick" key={x.id}>
          <span className="set-lbl">
            {x.label}
            <small>{x.help}</small>
          </span>
          <input type="checkbox" checked={used.includes(x.id)} disabled={!ready || !!busy} title={ready ? '' : 'Fill in the application ID first'} onChange={(e) => void toggle(x.id, e.target.checked)} />
        </label>
      ))}
      {signedIn && (
        <div className="set-row">
          <span className="set-lbl">
            Sign out<small>Removes the sign-in from the keychain and stops all three.</small>
          </span>
          <span>
            <button
              className="btn sm"
              disabled={!!busy}
              onClick={async () => {
                setBusy('out');
                await act.microsoftSignOut();
                setSt(await entraStatus());
                setBusy(null);
              }}
            >
              Sign out
            </button>
          </span>
        </div>
      )}
      <Guide id="microsoft" cfg={cfg} connected={signedIn} />
    </section>
  );
}
