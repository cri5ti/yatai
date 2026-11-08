import { useEffect, useState } from 'react';
import { useS, set } from './store';
import type { Flags, Layout, PrStatus } from './store';
import {
  addInboxSamples, followRealClock, loadDemo, setDemo, setPrComments, setPrStatus, jumpToNextMeeting, openCapture, redo, setClockManual, setFlag, setLayout, startEmpty, toggleDev, toggleHidden, undo,
} from './actions';
import { dbPath } from './persist';
import { isTauri, showCapture } from './platform';
import { fmt, plain, prLinks } from './model';
import { DEFAULT_COMMENTS, PR_STATUSES } from './Pr';

const layouts: { id: Layout; label: string; hint: string }[] = [
  { id: 'dock', label: 'Dock', hint: 'thin sidebar' },
  { id: 'float', label: 'Float', hint: 'medium window' },
  { id: 'max', label: 'Large', hint: 'organizer' },
  { id: 'pill', label: 'Pill', hint: 'always-on-top' },
];

const scenarios: { k: keyof Flags; label: string; group: string }[] = [
  { k: 'pipelineFailed', label: 'Pipeline: deploy failed', group: 'DevOps' },
  { k: 'workItemChanged', label: 'Work item: state changed', group: 'DevOps' },
  { k: 'aiNeedsFeedback', label: 'Claude: needs feedback', group: 'AI sessions' },
  { k: 'aiDone', label: 'Claude: finished', group: 'AI sessions' },
  { k: 'meetingMoved', label: 'Design review moved 14:00 → 11:30', group: 'Outlook' },
];

/** developer panel (tray → Developer panel, or ⌘⇧D): the POC's mock bar — simulated clock, connectors, scenarios, data */
export function DevPanel() {
  const s = useS();
  const [path, setPath] = useState('');
  useEffect(() => void dbPath().then(setPath), []);
  const groups = [...new Set(scenarios.map((x) => x.group))];
  const found = new Map<string, string[]>();
  for (const n of s.nodes) for (const l of prLinks(n.title)) found.set(l.key, [...(found.get(l.key) ?? []), plain(n.title.split('\n')[0]).slice(0, 40)]);
  const prs = [...found].map(([key, items]) => ({ key, items }));
  return (
    <aside className="controls devpanel" onKeyDown={(e) => e.key === 'Escape' && toggleDev()}>
      <div className="dev-head">
        <h2>Developer</h2>
        <button aria-label="Close" title="Close (⌘⇧D)" onClick={toggleDev}>
          ✕
        </button>
      </div>
      <p className="note">Data: {path || '…'}</p>

      <section>
        <h3>Data</h3>
        <label className="check-row">
          <input type="checkbox" checked={s.demo} onChange={(e) => setDemo(e.target.checked)} /> Demo connectors (mocked Outlook / GitHub / DevOps)
        </label>
        <div className="btnrow">
          <button onClick={loadDemo}>Load demo data</button>
          <button className="danger" onClick={startEmpty}>
            Start empty
          </button>
        </div>
        <p className="note">Both replace everything in yatai (undo does not bring it back).</p>
      </section>

      <section>
        <h3>Window layout</h3>
        <div className="seg">
          {layouts.map((l) => (
            <button key={l.id} className={s.layout === l.id ? 'on' : ''} onClick={() => setLayout(l.id)} title={l.hint}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="btnrow">
          <button onClick={toggleHidden}>{s.hidden ? 'Show window' : 'Hide to tray'}</button>
          <button onClick={() => (isTauri ? showCapture() : openCapture())}>Quick capture</button>
        </div>
      </section>

      <section>
        <h3>Clock · {fmt(s.clock)} {s.clockManual || s.clockSpeed ? '(simulated)' : '(real time)'}</h3>
        <input type="range" min={7 * 60} max={19 * 60} step={1} value={Math.round(s.clock)} onChange={(e) => setClockManual(+e.target.value)} />
        <div className="btnrow">
          <button onClick={() => (set(() => ({ clockManual: true })), jumpToNextMeeting(10))}>Jump: 10 min before next meeting</button>
          <button disabled={!s.clockManual && !s.clockSpeed} onClick={followRealClock}>
            Real time
          </button>
        </div>
        <label className="inline">
          Auto-advance
          <select value={s.clockSpeed} onChange={(e) => (+e.target.value ? set(() => ({ clockSpeed: +e.target.value, clockManual: true })) : set(() => ({ clockSpeed: 0 })))}>
            <option value={0}>paused</option>
            <option value={1}>1 min / sec</option>
            <option value={5}>5 min / sec</option>
            <option value={20}>20 min / sec</option>
          </select>
        </label>
      </section>

      <section>
        <h3>GitHub pull requests</h3>
        <p className="note">Every PR url found in your items. Pick a status to simulate GitHub changing it.</p>
        {prs.map((p) => (
          <label key={p.key} className="prrow">
            <span title={p.items.join(' · ')}>{p.key.replace(/^[^/]+\//, '')}</span>
            {(s.prs[p.key] ?? 'review') === 'feedback' && (
              <input className="prn" type="number" min={1} max={99} title="Unresolved comments" value={s.prc[p.key] ?? DEFAULT_COMMENTS} onChange={(e) => setPrComments(p.key, Math.max(1, +e.target.value || 1))} />
            )}
            <select value={s.prs[p.key] ?? 'review'} onChange={(e) => setPrStatus(p.key, e.target.value as PrStatus)}>
              {PR_STATUSES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {!prs.length && <p className="note">No PR links yet — paste a github.com/…/pull/123 url into any item.</p>}
      </section>

      <section>
        <h3>Smart-item scenarios</h3>
        {groups.map((g) => (
          <div key={g} className="grp">
            <div className="gl">{g}</div>
            {scenarios
              .filter((x) => x.group === g)
              .map((x) => (
                <label key={x.k} className="check-row">
                  <input type="checkbox" checked={s.flags[x.k]} onChange={(e) => setFlag(x.k, e.target.checked)} />
                  {x.label}
                </label>
              ))}
          </div>
        ))}
      </section>

      <section>
        <h3>Focus &amp; AI</h3>
        <label className="inline">
          Focus timer speed
          <select value={s.focusSpeed} onChange={(e) => set(() => ({ focusSpeed: +e.target.value }))}>
            <option value={1}>real time</option>
            <option value={30}>30× (25 min ≈ 50 s)</option>
            <option value={150}>150× (25 min ≈ 10 s)</option>
          </select>
        </label>
        <label className="inline">
          AI latency {s.aiDelay} ms
          <input type="range" min={0} max={3000} step={100} value={s.aiDelay} onChange={(e) => set(() => ({ aiDelay: +e.target.value }))} />
        </label>
      </section>

      <section>
        <h3>Display &amp; history</h3>
        <label className="check-row">
          <input type="checkbox" checked={s.dark} onChange={(e) => set(() => ({ dark: e.target.checked }))} /> Dark mode
        </label>
        <div className="btnrow">
          <button onClick={addInboxSamples}>+ Inbox samples</button>
          <button onClick={undo} disabled={!s.past.length}>
            ↶ Undo ({s.past.length})
          </button>
          <button onClick={redo} disabled={!s.future.length}>
            ↷ Redo ({s.future.length})
          </button>
        </div>
      </section>
    </aside>
  );
}
