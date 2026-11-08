import { useEffect, useRef, useState } from 'react';
import { useS } from './store';
import { act } from './act';
import { aiKeyStatus, aiSetKey, isTauri } from './platform';
import type { KeyStatus } from './platform';

const EFFORTS = ['', 'none', 'minimal', 'low', 'medium', 'high'];

/** ⌘, — the AI connection. The key goes to the OS keychain and is never read back into the page. */
export function Settings() {
  const s = useS();
  const [key, setKey] = useState('');
  const [st, setSt] = useState<KeyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!s.settingsOpen) return setKey('');
    void aiKeyStatus().then(setSt);
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('input, select')?.focus());
  }, [s.settingsOpen]);
  if (!s.settingsOpen) return null;

  const cfg = s.settings;
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
        <div className="lh">AI assistant (⌘/)</div>
        {isTauri ? (
          <label className="set-row">
            <span>OpenAI API key</span>
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
          </label>
        ) : (
          <p className="set-note">In the browser build the key comes from OPENAI_API_KEY in app/.env (added by the dev server).</p>
        )}
        <p className="set-note">{st == null ? '…' : st.configured ? '✓ The assistant is on.' : 'No key: the assistant gives mocked replies.'}</p>
        <label className="set-row">
          <span>Model</span>
          <input value={cfg.model} spellCheck={false} disabled={!isTauri} onChange={(e) => patch({ model: e.target.value })} placeholder="gpt-4.1-mini" />
        </label>
        <label className="set-row">
          <span>Reasoning effort</span>
          <select value={cfg.effort} disabled={!isTauri} onChange={(e) => patch({ effort: e.target.value })}>
            {EFFORTS.map((x) => (
              <option key={x} value={x}>
                {x || 'model default'}
              </option>
            ))}
          </select>
        </label>
        <label className="set-row">
          <span>API base URL</span>
          <input value={cfg.baseUrl} spellCheck={false} disabled={!isTauri} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
        </label>
        <div className="set-foot">
          <button className="btn" onClick={() => act.closeSettings()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
