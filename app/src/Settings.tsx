import { useEffect, useRef, useState } from 'react';
import { get, useS } from './store';
import { act } from './act';
import { aiKeyStatus, aiSetKey, invoke, isTauri } from './platform';
import type { KeyStatus } from './platform';
import { PLUGINS } from './plugins/registry';
import { normHost } from './model';
import { GhIcon } from './Pr';
import { Guide } from './guides';
import { DisplayControls } from './display';

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + (m || 0);
};
const GLYPH: Record<string, string> = { db: '▤', ai: '✦', outlook: '▦', devops: '◇', mail: '✉', display: 'Aa' };
const Ico = ({ id }: { id: string }) => <span className="set-ico">{id === 'github' ? <GhIcon /> : GLYPH[id] ?? '●'}</span>;

interface BackupCfg { daily: boolean; dailyKeep: number; frequent: boolean; frequentEveryMin: number; frequentKeep: number }
interface BackupInfo { name: string; kind: 'daily' | 'frequent'; size: number; modified: number }
interface BackupStatus { dbPath: string; dbSize: number; dir: string; config: BackupCfg; backups: BackupInfo[] }

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const EVERY = [5, 15, 30, 60];

/** the database file, and its automatic backups (src-tauri/src/backup.rs does the work; this only sets the schedule) */
function Database({ draft, onLoad, onChange }: { draft: BackupCfg | null; onLoad: (c: BackupCfg) => void; onChange: (p: Partial<BackupCfg>) => void }) {
  const [st, setSt] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => invoke<BackupStatus>('backup_status').then((x) => (setSt(x), onLoad(x.config)), (e) => act.toast(`Backups: ${String(e)}`, 'bad'));
  useEffect(() => void load(), []);
  if (!isTauri) {
    return (
      <section className="set-sec">
        <header><h4>Database</h4><span className="set-hint">browser build</span></header>
        <p className="set-note">The browser build keeps the document in this browser's localStorage (key yatai-app-v1). Backups are part of the desktop app.</p>
      </section>
    );
  }
  const cfg = draft ?? undefined;
  const patch = (p: Partial<BackupCfg>) => onChange(p);
  const keep = (k: 'dailyKeep' | 'frequentKeep', max: number) => (
    <input type="number" min={1} max={max} value={cfg![k]} onChange={(e) => e.target.value && patch({ [k]: Math.max(1, Math.min(max, +e.target.value | 0)) })} />
  );
  const now = async () => {
    setBusy(true);
    try {
      await invoke('backup_now');
      setSt(await invoke<BackupStatus>('backup_status'));
      act.toast('Backup taken', 'good');
    } catch (e) {
      act.toast(`Backup: ${String(e)}`, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const count = (k: string) => st?.backups.filter((b) => b.kind === k).length ?? 0;
  return (
    <section className="set-sec">
      <header>
        <h4>Database</h4>
        <span className="set-hint">{st ? `${bytes(st.dbSize)} · SQLite` : '…'}</span>
      </header>
      <div className="set-row">
        <span className="set-lbl">Location<small>Everything lives in this one file. Quit yatai before copying or replacing it.</small></span>
        <span className="set-key">
          <input readOnly value={st?.dbPath ?? ''} onFocus={(e) => e.target.select()} />
          <button className="btn sm" onClick={() => invoke('backup_reveal', { which: 'data' })}>Show</button>
        </span>
      </div>
      <div className="set-row">
        <span className="set-lbl">Daily snapshot<small>One per day, taken the first time yatai runs that day. {count('daily')} kept now.</small></span>
        <span className="set-opt">
          <label><input type="checkbox" checked={!!cfg?.daily} disabled={!cfg} onChange={(e) => patch({ daily: e.target.checked })} /> on</label>
          {cfg && <label className={cfg.daily ? '' : 'off'}>keep {keep('dailyKeep', 365)} days</label>}
        </span>
      </div>
      <div className="set-row">
        <span className="set-lbl">Frequent snapshot<small>At most one per interval, and only if something changed since the last one. {count('frequent')} kept now.</small></span>
        <span className="set-opt">
          <label><input type="checkbox" checked={!!cfg?.frequent} disabled={!cfg} onChange={(e) => patch({ frequent: e.target.checked })} /> on</label>
          {cfg && (
            <>
              <label className={cfg.frequent ? '' : 'off'}>every{' '}
                <select value={cfg.frequentEveryMin} onChange={(e) => patch({ frequentEveryMin: +e.target.value })}>
                  {(EVERY.includes(cfg.frequentEveryMin) ? EVERY : [...EVERY, cfg.frequentEveryMin].sort((a, b) => a - b)).map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </label>
              <label className={cfg.frequent ? '' : 'off'}>keep {keep('frequentKeep', 200)}</label>
            </>
          )}
        </span>
      </div>
      <div className="set-row">
        <span className="set-lbl">Backups<small>{st?.dir}</small></span>
        <span className="set-key">
          <button className="btn sm" disabled={busy || !cfg} onClick={now}>Back up now</button>
          <button className="btn sm" onClick={() => invoke('backup_reveal', { which: 'backups' })}>Show folder</button>
        </span>
      </div>
      {!!st?.backups.length && (
        <ul className="set-bk" aria-label="Backups">
          {st.backups.slice(0, 8).map((b) => (
            <li key={b.name}><span>{b.kind === 'daily' ? 'daily' : 'snapshot'}</span><span>{when(b.modified)}</span><span>{bytes(b.size)}</span></li>
          ))}
          {st.backups.length > 8 && <li className="more">… and {st.backups.length - 8} older</li>}
        </ul>
      )}
      <p className="set-note">To restore: quit yatai, then copy a backup over yatai.db (and delete yatai.db-wal / -shm next to it).</p>
    </section>
  );
}

const EFFORTS = ['', 'none', 'minimal', 'low', 'medium', 'high'];

/** ⌘, — the AI connection. The key goes to the OS keychain and is never read back into the page. */
export function Settings() {
  const s = useS();
  const [key, setKey] = useState('');
  const [st, setSt] = useState<KeyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState('ai');
  const [tok, setTok] = useState<Record<string, string>>({});
  const [d, setD] = useState<typeof s.settings | null>(null); // the edited copy of the settings
  const [bk, setBk] = useState<{ base: BackupCfg | null; draft: BackupCfg | null }>({ base: null, draft: null });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!s.settingsOpen) return (setKey(''), setTok({}), setD(null), setBk({ base: null, draft: null }));
    setD({ ...get().settings });
    void aiKeyStatus().then(setSt);
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('input, select')?.focus());
  }, [s.settingsOpen]);
  if (!s.settingsOpen) return null;

  const cfg = d ?? s.settings;
  const accts = PLUGINS.filter((p) => p.auth);
  const patch = (p: Partial<typeof cfg>) => setD({ ...cfg, ...p });
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const dirty = !same(cfg, s.settings) || !!key.trim() || Object.values(tok).some((t) => t?.trim()) || (!!bk.draft && !same(bk.draft, bk.base));

  /** keys and tokens go to the keychain, the rest of the settings and the backup schedule are stored: all together, or nothing */
  const save = async () => {
    setBusy(true);
    try {
      if (!same(cfg, s.settings)) act.patchUi({ settings: cfg });
      if (cfg.mailModel !== s.settings.mailModel) act.resortMail();
      if (bk.draft && !same(bk.draft, bk.base)) await invoke('backup_set_config', { config: bk.draft });
      if (key.trim()) {
        setSt(await aiSetKey(key));
        act.refreshAi();
      }
      for (const [id, t] of Object.entries(tok)) if (t?.trim()) await act.connectPlugin(id, t);
      act.toast('Settings saved', 'good');
      act.closeSettings();
    } catch (e) {
      act.toast(`Could not save: ${String(e)}`, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const removeKey = async () => {
    setBusy(true);
    try {
      setSt(await aiSetKey(''));
      act.refreshAi();
      act.toast('API key removed', 'info');
    } catch (e) {
      act.toast(`Keychain: ${String(e)}`, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const enter = (e: React.KeyboardEvent) => e.key === 'Enter' && dirty && (e.preventDefault(), void save());

  return (
    <div className="ai-veil" onMouseDown={() => act.closeSettings()}>
      <div
        className="help settings"
        role="dialog"
        aria-label="Settings"
        ref={box}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') (e.preventDefault(), act.closeSettings()); // discards the edits
        }}
      >
        <h3>Settings</h3>
        <div className="set-layout">
        <nav className="set-nav" aria-label="Sections">
          {[{ id: 'ai', name: 'AI assistant' }, ...accts, { id: 'mail', name: 'Emails' }, { id: 'display', name: 'Display' }, { id: 'db', name: 'Database' }].map((x) => (
            <button key={x.id} className={sec === x.id ? 'on' : ''} aria-current={sec === x.id} onClick={() => setSec(x.id)}>
              <Ico id={x.id} /> {x.name}
            </button>
          ))}
        </nav>
        <div className="set-body">
        {sec === 'display' && (
          <section className="set-sec">
            <header>
              <h4>Display</h4>
              <span className="set-hint">applies at once</span>
            </header>
            <div className="set-row">
              <span className="set-lbl">
                Scale and density<small>The size of everything, and how much room each row gets. Also under Aa in the window's footer.</small>
              </span>
              <DisplayControls labels />
            </div>
          </section>
        )}
        {sec === 'db' && <Database draft={bk.draft} onLoad={(c) => setBk((x) => (x.base ? x : { base: c, draft: c }))} onChange={(p) => setBk((x) => x.draft ? { ...x, draft: { ...x.draft, ...p } } : x)} />}
        {sec === 'ai' && <section className="set-sec">
          <header>
            <h4>AI assistant</h4>
            <span className="set-hint">⌘/ · {st == null ? '…' : st.configured ? '✓ on' : 'no key: replies are mocked'}</span>
          </header>
          {isTauri ? (
            <div className="set-row">
              <span className="set-lbl">OpenAI API key<small>Kept in the OS keychain, never shown again.</small></span>
              <span className="set-key">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={st?.configured ? (st.source === 'env' ? 'set from the environment (.env)' : '•••••••• in the keychain') : 'sk-…'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={enter}
                />
                {st?.source === 'keychain' && (
                  <button className="btn sm" disabled={busy} onClick={removeKey}>
                    Remove
                  </button>
                )}
              </span>
            </div>
          ) : (
            <p className="set-note">In the browser build the key comes from OPENAI_API_KEY in app/.env (added by the dev server).</p>
          )}
          <div className="set-row">
            <span className="set-lbl">Model</span>
            <input value={cfg.model} spellCheck={false} disabled={!isTauri} onChange={(e) => patch({ model: e.target.value })} placeholder="gpt-4.1-mini" />
          </div>
          <div className="set-row">
            <span className="set-lbl">Reasoning effort</span>
            <select value={cfg.effort} disabled={!isTauri} onChange={(e) => patch({ effort: e.target.value })}>
              {EFFORTS.map((x) => (
                <option key={x} value={x}>
                  {x || 'model default'}
                </option>
              ))}
            </select>
          </div>
          <div className="set-row">
            <span className="set-lbl">API base URL</span>
            <input value={cfg.baseUrl} spellCheck={false} disabled={!isTauri} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
          </div>
        </section>}
        {sec === 'mail' && (
          <section className="set-sec">
            <header>
              <h4>Emails</h4>
              <span className="set-hint">{!isTauri ? 'needs the desktop app' : s.mail.polled ? `${s.mail.items.length} emails · read ${new Date(s.mail.polled).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'not read yet'}</span>
            </header>
            <p className="set-note">
              Reads the Inbox of the classic Outlook on this PC (it has to be set up; it starts in the background) and sorts each email with a local model: Urgent, Today, Eventually or Dismiss.
              Nothing leaves the machine, and nothing is changed in Outlook.
            </p>
            <div className="set-row">
              <span className="set-lbl">
                Local model<small>An Ollama model on this PC (ollama pull &lt;name&gt;). Changing it sorts every email again.</small>
              </span>
              <input value={cfg.mailModel} spellCheck={false} disabled={!isTauri} onChange={(e) => patch({ mailModel: e.target.value.trim() })} onKeyDown={enter} placeholder="llama3.2" />
            </div>
            <div className="set-row">
              <span className="set-lbl">
                Sort again<small>Forget how every email was sorted and ask the model again.</small>
              </span>
              <button className="btn sm" disabled={!isTauri || !s.mail.items.length} onClick={() => act.resortMail()}>
                Sort all again
              </button>
            </div>
          </section>
        )}
        {accts.filter((p) => p.id === sec).map((p) => {
          const acc = s.accounts[p.id];
          const state =
            !isTauri
              ? 'needs the desktop app'
              : acc?.state === 'connected'
                ? `✓ connected${acc.as ? ` as ${acc.as}` : ''}${p.id === 'github' ? ` (${normHost(cfg.githubHost)})` : p.id === 'devops' && cfg.devopsOrg ? ` (${cfg.devopsOrg})` : ''}`
                : acc?.state === 'expired'
                  ? 'token rejected'
                  : 'not connected';
          return (
            <section className="set-sec" key={p.id}>
              <header>
                <h4>{p.name}</h4>
                <span className="set-hint">{state}</span>
              </header>
              {p.id === 'github' && (
                <div className="set-row">
                  <span className="set-lbl">GitHub host</span>
                  <input value={cfg.githubHost} spellCheck={false} disabled={!isTauri} onChange={(e) => patch({ githubHost: e.target.value })} placeholder="github.com (or ghe.example.com)" />
                </div>
              )}
              {p.id === 'outlook' && (
                <div className="set-row">
                  <span className="set-lbl">
                    Working hours<small>The schedule view fits them on 80% of the drawer. A published calendar does not carry them.</small>
                  </span>
                  <span className="set-hours">
                    <input type="time" value={hhmm(cfg.workStart)} onChange={(e) => e.target.value && patch({ workStart: mins(e.target.value) })} />
                    <span>to</span>
                    <input type="time" value={hhmm(cfg.workEnd)} onChange={(e) => e.target.value && patch({ workEnd: Math.max(mins(e.target.value), cfg.workStart + 60) })} />
                  </span>
                </div>
              )}
              {p.id === 'devops' && (
                <div className="set-row">
                  <span className="set-lbl">
                    Organization<small>Pipeline run links of this organization are tracked live.</small>
                  </span>
                  <input value={cfg.devopsOrg} spellCheck={false} disabled={!isTauri} onChange={(e) => patch({ devopsOrg: e.target.value })} placeholder="dev.azure.com/acme (or acme.visualstudio.com)" />
                </div>
              )}
              <div className="set-row">
                <span className="set-lbl">
                  {p.auth!.field.label}
                  <small>{acc?.state === 'expired' ? `${p.name} rejected it: paste a new one.` : p.auth!.field.help} Kept in the OS keychain.</small>
                </span>
                <span className="set-key">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!isTauri}
                    placeholder={acc?.state === 'connected' ? '•••••••• in the keychain' : p.auth!.field.placeholder}
                    value={tok[p.id] ?? ''}
                    onChange={(e) => setTok({ ...tok, [p.id]: e.target.value })}
                    onKeyDown={enter}
                  />
                  {acc?.state !== 'none' && acc?.state != null && (
                    <button className="btn sm" disabled={busy} onClick={() => void act.disconnectPlugin(p.id)}>
                      Remove
                    </button>
                  )}
                </span>
              </div>
              <Guide id={p.id} cfg={cfg} connected={acc?.state === 'connected'} />
            </section>
          );
        })}
        </div>
        </div>
        <div className="set-foot">
          <span className="set-dirty">{dirty ? 'Unsaved changes' : ''}</span>
          {dirty ? (
            <>
              <button className="btn" disabled={busy} onClick={() => act.closeSettings()}>
                Discard
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void save()}>
                Save
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => act.closeSettings()}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
