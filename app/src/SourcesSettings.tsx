/** Settings → Sources: switch each source on or off and pick how it signs in. The pages of the sources that are on follow. */
import { useState } from 'react';
import type { Settings } from './store';
import { isTauri } from './platform';
import { PLUGINS } from './plugins/registry';
import { METHODS, enabled, methodOf } from './plugins/config';
import { azCheck } from './plugins/azcli';
import { Guide } from './guides';

/** the sources that can be switched on and off, in the footer's order */
const ORDER = ['outlook', 'github', 'devops', 'mail', 'claude', 'copilot', 'codex'];
const HARNESSES = ['claude', 'copilot', 'codex'];
const WHAT: Record<string, string> = {
  outlook: 'Meetings for Next and the schedule.',
  github: 'Pull requests, followed live.',
  devops: 'Pipeline runs and work items.',
  mail: 'Unread mail, sorted on this PC.',
  claude: 'Claude Code sessions on this PC.',
  copilot: 'GitHub Copilot sessions on this PC.',
  codex: 'Recent Codex sessions on this PC.',
};

export function SourcesSettings({ cfg, patch }: { cfg: Settings; patch: (p: Partial<Settings>) => void }) {
  const set = (id: string, v: { on?: boolean; auth?: string }) => patch({ sources: { ...cfg.sources, [id]: { ...cfg.sources?.[id], ...v } } });
  return (
    <section className="set-sec">
      <header>
        <h4>Sources</h4>
        <span className="set-hint">{ORDER.filter((id) => enabled(cfg, id)).length} on</span>
      </header>
      <p className="set-note">Switch on what you use and choose how each one signs in. A source that is off disappears from the footer and is not polled; the settings pages of the ones that are on appear on the left.</p>
      {[false, true].map((harnesses) => <div key={String(harnesses)}>
      {harnesses && <h4>Coding harnesses</h4>}
      {PLUGINS.filter((p) => ORDER.includes(p.id) && HARNESSES.includes(p.id) === harnesses)
        .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
        .map((p) => {
          const ms = METHODS[p.id] ?? [];
          const on = enabled(cfg, p.id);
          const how = methodOf(cfg, p.id);
          return (
            <div className="set-row set-tick" key={p.id}>
              <span className="set-lbl">
                {p.name}
                <small>{ms.find((m) => m.id === how)?.help ?? WHAT[p.id]}</small>
              </span>
              <span className="set-hours">
                <input type="checkbox" checked={on} aria-label={`${p.name} on`} onChange={(e) => set(p.id, { on: e.target.checked })} />
                {ms.length > 1 ? (
                  <select value={how} disabled={!on || !isTauri} aria-label={`How ${p.name} signs in`} onChange={(e) => set(p.id, { auth: e.target.value })}>
                    {ms.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{on ? WHAT[p.id] : ''}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>)}
    </section>
  );
}

/** Settings → Azure DevOps, when it signs in with the Azure CLI: is `az` there, and signed in? */
export function AzSection({ cfg, connected }: { cfg: Settings; connected: boolean }) {
  const [res, setRes] = useState<{ ok: boolean; text: string } | 'busy' | null>(null);
  const check = () => {
    setRes('busy');
    azCheck().then(
      () => setRes({ ok: true, text: 'signed in' }),
      (e) => setRes({ ok: false, text: String(e) }),
    );
  };
  return (
    <>
      <div className="set-row">
        <span className="set-lbl">
          Azure CLI<small>yatai asks the CLI for a token when it needs one.</small>
        </span>
        <span className="set-key">
          <input readOnly value={res === 'busy' ? 'asking az…' : res ? `${res.ok ? '✓' : '✕'} ${res.text}` : 'not checked yet'} />
          <button className="btn sm" disabled={!isTauri || res === 'busy'} onClick={check}>
            Check
          </button>
        </span>
      </div>
      <Guide id="azcli" cfg={cfg} connected={connected} />
    </>
  );
}
