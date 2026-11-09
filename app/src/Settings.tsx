import { useEffect, useRef, useState } from 'react';
import { useS } from './store';
import { act } from './act';
import { aiKeyStatus, aiSetKey, isTauri } from './platform';
import type { KeyStatus } from './platform';
import { PLUGINS } from './plugins/registry';
import { normHost } from './model';
import { GhIcon } from './Pr';

const GLYPH: Record<string, string> = { ai: '✦', outlook: '▦', devops: '◇' };
const Ico = ({ id }: { id: string }) => <span className="set-ico">{id === 'github' ? <GhIcon /> : GLYPH[id] ?? '●'}</span>;

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
          {[{ id: 'ai', name: 'AI assistant' }, ...accts].map((x) => (
            <button key={x.id} className={sec === x.id ? 'on' : ''} aria-current={sec === x.id} onClick={() => setSec(x.id)}>
              <Ico id={x.id} /> {x.name}
            </button>
          ))}
        </nav>
        <div className="set-body">
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
