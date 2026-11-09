import { useEffect, useRef, useState } from 'react';
import { useS } from './store';
import { act } from './act';
import { aiKeyStatus, aiSetKey, invoke, isTauri } from './platform';
import type { KeyStatus } from './platform';
import { PLUGINS } from './plugins/registry';
import { normHost } from './model';
import { GhIcon } from './Pr';

const GLYPH: Record<string, string> = { db: '▤', ai: '✦', outlook: '▦', devops: '◇' };
const Ico = ({ id }: { id: string }) => <span className="set-ico">{id === 'github' ? <GhIcon /> : GLYPH[id] ?? '●'}</span>;

interface BackupCfg { daily: boolean; dailyKeep: number; frequent: boolean; frequentEveryMin: number; frequentKeep: number }
interface BackupInfo { name: string; kind: 'daily' | 'frequent'; size: number; modified: number }
interface BackupStatus { dbPath: string; dbSize: number; dir: string; config: BackupCfg; backups: BackupInfo[] }

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const EVERY = [5, 15, 30, 60];

/** the database file, and its automatic backups (src-tauri/src/backup.rs does the work; this only sets the schedule) */
function Database() {
  const [st, setSt] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => invoke<BackupStatus>('backup_status').then(setSt, (e) => act.toast(`Backups: ${String(e)}`, 'bad'));
  useEffect(() => void load(), []);
  if (!isTauri) {
    return (
      <section className="set-sec">
        <header><h4>Database</h4><span className="set-hint">browser build</span></header>
        <p className="set-note">The browser build keeps the document in this browser's localStorage (key yatai-app-v1). Backups are part of the desktop app.</p>
      </section>
    );
  }
  const cfg = st?.config;
  const patch = async (p: Partial<BackupCfg>) => {
    if (!cfg) return;
    try {
      const config = await invoke<BackupCfg>('backup_set_config', { config: { ...cfg, ...p } });
      setSt((x) => x && { ...x, config });
      void load(); // the lists may have been trimmed
    } catch (e) {
      act.toast(`Backups: ${String(e)}`, 'bad');
    }
  };
  const keep = (k: 'dailyKeep' | 'frequentKeep', max: number) => (
    <input type="number" min={1} max={max} value={cfg![k]} onChange={(e) => e.target.value && patch({ [k]: Math.max(1, Math.min(max, +e.target.value | 0)) })} />
  );
  const now = async () => {
    setBusy(true);
    try {
      await invoke('backup_now');
      await load();
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
        <span className="set-lbl">Daily snapshot<small>One per day, taken the first time yatai runs that day. {cfg?.daily ? `${count('daily')} kept.` : ''}</small></span>
        <span className="set-opt">
          <label><input type="checkbox" checked={!!cfg?.daily} disabled={!cfg} onChange={(e) => patch({ daily: e.target.checked })} /> on</label>
          {cfg && <label className={cfg.daily ? '' : 'off'}>keep {keep('dailyKeep', 365)} days</label>}
        </span>
      </div>
      <div className="set-row">
        <span className="set-lbl">Frequent snapshot<small>At most one per interval, and only if something changed since the last one. {cfg?.frequent ? `${count('frequent')} kept.` : ''}</small></span>
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
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!s.settingsOpen) return (setKey(''), setTok({}));
    void aiKeyStatus().then(setSt);
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('input, select')?.focus());
  }, [s.settingsOpen]);
  if (!s.settingsOpen) return null;

  const cfg = s.settings;
  const accts = PLUGINS.filter((p) => p.auth);
  const patch = (p: Partial<typeof cfg>) => act.patchUi({ settings: { ...cfg, ...p } });
  const saveKey = async (k: string) => {
    setBusy(true);
    try {
      setSt(await aiSetKey(k));
      setKey('');
      act.refreshAi();
      act.toast(k ? 'API key saved to the keychain' : 'API key removed', 'good');
    } catch (e) {
      act.toast(`Keychain: ${String(e)}`, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const saveTok = async (id: string) => {
    const t = tok[id];
    if (!t?.trim()) return;
    setBusy(true);
    await act.connectPlugin(id, t);
    setTok({ ...tok, [id]: '' });
    setBusy(false);
  };

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
          if (e.key === 'Escape') (e.preventDefault(), act.closeSettings());
        }}
      >
        <h3>Settings</h3>
        <div className="set-layout">
        <nav className="set-nav" aria-label="Sections">
          {[{ id: 'ai', name: 'AI assistant' }, ...accts, { id: 'db', name: 'Database' }].map((x) => (
            <button key={x.id} className={sec === x.id ? 'on' : ''} aria-current={sec === x.id} onClick={() => setSec(x.id)}>
              <Ico id={x.id} /> {x.name}
            </button>
          ))}
        </nav>
        <div className="set-body">
        {sec === 'db' && <Database />}
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
                  onKeyDown={(e) => e.key === 'Enter' && key.trim() && (e.preventDefault(), void saveKey(key))}
                />
                <button className="btn sm" disabled={busy || !key.trim()} onClick={() => saveKey(key)}>
                  Save
                </button>
                {st?.source === 'keychain' && (
                  <button className="btn sm" disabled={busy} onClick={() => saveKey('')}>
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
        {accts.filter((p) => p.id === sec).map((p) => {
          const acc = s.accounts[p.id];
          const state =
            !isTauri
              ? 'needs the desktop app'
              : acc?.state === 'connected'
                ? `✓ connected${acc.as ? ` as ${acc.as}` : ''}${p.id === 'github' ? ` (${normHost(cfg.githubHost)})` : ''}`
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
                    onKeyDown={(e) => e.key === 'Enter' && tok[p.id]?.trim() && (e.preventDefault(), saveTok(p.id))}
                  />
                  <button className="btn sm" disabled={busy || !tok[p.id]?.trim()} onClick={() => saveTok(p.id)}>
                    Save
                  </button>
                  {acc?.state !== 'none' && acc?.state != null && (
                    <button className="btn sm" disabled={busy} onClick={() => void act.disconnectPlugin(p.id)}>
                      Remove
                    </button>
                  )}
                </span>
              </div>
            </section>
          );
        })}
        </div>
        </div>
        <div className="set-foot">
          <button className="btn" onClick={() => act.closeSettings()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
